import { getCampaignBalance } from './balance.ts';

try {
  const balance = await getCampaignBalance();
  console.log(`Network: ${balance.network}`);
  console.log(`Campaign: ${balance.address}`);
  console.log(`Balance: ${balance.lamports} lamports (${balance.sol} SOL)`);
} catch (error) {
  console.error(`Balance check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exitCode = 1;
}
