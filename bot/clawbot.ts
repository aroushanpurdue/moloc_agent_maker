import dotenv from "dotenv";
dotenv.config();

import { ethers } from "ethers";
import axios from "axios";

const config = {
  rpcUrl: "https://dream-rpc.somnia.network",
  apiUrl: "https://moloch-delta.vercel.app",
  botRegistry: "0x8eA60104DEB3229a05534E4629C0C08Deac39609",
  permissionsRegistry: "0x02a7EE2fD25A8987a3e9276530c830735e0C5e8C",
  lendingPool: "0x11f49c44eA263FC886B3C011DC171ffE479A48BF",
  usdc: "0xa5906CF6b40842aE6CdDcB051C3dd388ddD9535f",
  privateKey: process.env.BOT_PRIVATE_KEY || "",
};

// V2 ABIs
const BOT_REGISTRY_ABI = [
  "function registerBot(string calldata metadataHash, address operator) external returns (uint256)",
  "function operatorBots(address operator, uint256 index) external view returns (uint256)",
  "event BotRegistered(uint256 indexed botId, address indexed operator, string metadataHash, uint256 timestamp)",
];

const PERMISSIONS_ABI = [
  "function setPermissions(uint256 botId, bytes32 permissionsHash, uint256 maxSpend, uint256 expiry) external",
];

const LENDING_POOL_V2_ABI = [
  "function borrow(uint256 botId, uint256 amount) external",
  "function repay(uint256 botId, uint256 amount) external",
  "function loans(uint256 botId) external view returns (uint256 principal, uint256 borrowIndexAtStart, uint256 startTime, uint256 deadline, bool active)",
  "function borrowIndex() external view returns (uint256)",
];

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
];

class ClawBot {
  provider: ethers.JsonRpcProvider;
  wallet: ethers.Wallet;
  botId: number | null = null;
  
  botRegistry: ethers.Contract;
  permissionsRegistry: ethers.Contract;
  lendingPool: ethers.Contract;
  usdc: ethers.Contract;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    
    this.botRegistry = new ethers.Contract(config.botRegistry, BOT_REGISTRY_ABI, this.wallet);
    this.permissionsRegistry = new ethers.Contract(config.permissionsRegistry, PERMISSIONS_ABI, this.wallet);
    this.lendingPool = new ethers.Contract(config.lendingPool, LENDING_POOL_V2_ABI, this.wallet);
    this.usdc = new ethers.Contract(config.usdc, ERC20_ABI, this.wallet);
    
    console.log(`🤖 Bot Wallet: ${this.wallet.address}`);
  }

  async checkExistingBot() {
    try {
      const botId = await this.botRegistry.operatorBots(this.wallet.address, 0);
      if (botId > 0) {
        this.botId = Number(botId);
        console.log(`   ✅ Found Bot ID: ${this.botId}`);
        return true;
      }
    } catch {}
    return false;
  }

  async register() {
    console.log("\n📝 Step 1: Registering Bot...");
    if (await this.checkExistingBot()) return;
    
    const tx = await this.botRegistry.registerBot("ipfs://QmClawBot", this.wallet.address);
    console.log(`   Tx sent: ${tx.hash}`);
    const receipt = await tx.wait();
    
    for (const log of receipt.logs) {
      try {
        const parsed = this.botRegistry.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed?.name === "BotRegistered") {
          this.botId = Number(parsed.args.botId);
          console.log(`   ✅ Registered! Bot ID: ${this.botId}`);
        }
      } catch {}
    }
  }

  async grantPermissions(max: number = 100) {
    console.log("\n🔐 Step 2: Granting Permissions...");
    console.log(`   Max borrow: ${max} USDC`);
    
    const tx = await this.permissionsRegistry.setPermissions(
      this.botId!,
      ethers.ZeroHash,
      ethers.parseUnits(max.toString(), 6),
      0
    );
    await tx.wait();
    console.log(`   ✅ Permissions granted!`);
  }

  async clearExistingLoan() {
    try {
      const [principal, borrowIndexAtStart, , , active] = await this.lendingPool.loans(this.botId!);
      
      if (active && principal > 0n) {
        console.log(`\n⚠️ Clearing existing loan first...`);
        
        const currentBorrowIndex = await this.lendingPool.borrowIndex();
        const interest = (principal * (currentBorrowIndex - borrowIndexAtStart)) / borrowIndexAtStart;
        const totalOwed = principal + interest;
        
        console.log(`   Repaying: ${ethers.formatUnits(totalOwed, 6)} USDC`);
        
        const approveTx = await this.usdc.approve(config.lendingPool, totalOwed);
        await approveTx.wait();
        
        const repayTx = await this.lendingPool.repay(this.botId!, totalOwed);
        await repayTx.wait();
        
        console.log(`   ✅ Loan cleared!`);
      }
    } catch (error: any) {
      console.log(`   ℹ️ No existing loan to clear`);
    }
  }

  async borrowAndRepay(amount: number, cycleNum: number) {
    try {
      console.log(`\n💰 Cycle ${cycleNum}: Borrow & Repay ${amount} USDC`);
      
      const amountWei = ethers.parseUnits(amount.toString(), 6);
      
      // Borrow
      console.log(`   📥 Borrowing...`);
      const borrowTx = await this.lendingPool.borrow(this.botId!, amountWei);
      const borrowReceipt = await borrowTx.wait();
      console.log(`   ✅ Borrowed! Tx: ${borrowReceipt.hash.slice(0, 10)}...`);
      
      // Simulate AI work
      console.log(`   🤖 AI Agent working...`);
      await this.sleep(2000);
      
      // Get loan details for repayment
      const [principal, borrowIndexAtStart] = await this.lendingPool.loans(this.botId!);
      const currentBorrowIndex = await this.lendingPool.borrowIndex();
      
      const interest = (principal * (currentBorrowIndex - borrowIndexAtStart)) / borrowIndexAtStart;
      const totalOwed = principal + interest;
      
      console.log(`   💸 Repaying ${ethers.formatUnits(totalOwed, 6)} USDC...`);
      
      // Approve
      const approveTx = await this.usdc.approve(config.lendingPool, totalOwed);
      await approveTx.wait();
      
      // Repay
      const repayTx = await this.lendingPool.repay(this.botId!, totalOwed);
      const repayReceipt = await repayTx.wait();
      console.log(`   ✅ Repaid! Tx: ${repayReceipt.hash.slice(0, 10)}...`);
      
      // Update DB
      await axios.post(`${config.apiUrl}/api/borrow`, {
        botId: this.botId,
        amount: amountWei.toString(),
        txHash: borrowReceipt.hash,
        walletAddress: this.wallet.address,
      }).catch(() => {});
      
      await axios.post(`${config.apiUrl}/api/repay`, {
        botId: this.botId,
        amount: totalOwed.toString(),
        txHash: repayReceipt.hash,
        walletAddress: this.wallet.address,
      }).catch(() => {});
      
      console.log(`   ✅ Cycle ${cycleNum} complete!`);
      
    } catch (error: any) {
      console.error(`   ❌ Cycle ${cycleNum} failed:`, error.message);
      throw error;
    }
  }

  async checkScore() {
    try {
      console.log("\n📊 Final Credit Score:");
      const res = await axios.get(`${config.apiUrl}/api/wallet-stats?wallet=${this.wallet.address}`);
      if (res.data.success && res.data.stats) {
        const s = res.data.stats;
        console.log(`   Total Borrows: ${s.borrowCount}`);
        console.log(`   Total Repays: ${s.repayCount}`);
        console.log(`   Amount Borrowed: $${s.totalBorrowedAmount}`);
        console.log(`   Amount Repaid: $${s.totalRepaidAmount}`);
        console.log(`   Credit Score: ${(s.creditScoreRatio * 100).toFixed(1)}% ⭐`);
      }
    } catch (error: any) {
      console.log(`   ⚠️ Could not fetch score`);
    }
  }

  async run() {
    try {
      console.log("\n🚀 ClawBot - Automated Lending Agent");
      console.log("=" .repeat(60));
      
      await this.register();
      await this.grantPermissions(100);
      await this.clearExistingLoan();
      
      // Do 3 borrow/repay cycles
      const cycles = 3;
      const amountPerCycle = 5;
      
      for (let i = 1; i <= cycles; i++) {
        await this.borrowAndRepay(amountPerCycle, i);
        if (i < cycles) {
          console.log(`\n   ⏳ Waiting 3 seconds...\n`);
          await this.sleep(3000);
        }
      }
      
      await this.checkScore();
      
      console.log("\n" + "=" .repeat(60));
      console.log("✅ All cycles completed successfully! 🎉");
      console.log(`🤖 Bot ID: ${this.botId}`);
      console.log(`💰 Wallet: ${this.wallet.address}`);
      console.log();
      
    } catch (error: any) {
      console.error("\n❌ Bot failed:", error.message);
      process.exit(1);
    }
  }

  sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
  }
}

// Run the bot
const bot = new ClawBot();
bot.run();