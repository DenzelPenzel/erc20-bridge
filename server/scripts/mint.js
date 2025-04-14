const { ethers } = require('ethers');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  const recipientAddress = args[0];
  const amountArg = args[1] || '10';
  const network = args[2] || 'arbitrum';

  const rpcUrl =
    network.toLowerCase() === 'optimism'
      ? process.env.RPC_OPSEPOLIA
      : process.env.RPC_ARBITRUMSEPOLIA;
  const contractAddress =
    network.toLowerCase() === 'optimism'
      ? process.env.OPTIMISM_ERC20_ADDRESS
      : process.env.ARBITRUM_ERC20_ADDRESS;

  console.log(`Using network: ${network}`);
  console.log('Using RPC:', rpcUrl);
  console.log('Contract address:', contractAddress);
  console.log('Recipient address:', recipientAddress);
  console.log('Amount to mint:', amountArg);

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log('Connected to network:', (await provider.getNetwork()).name);
  console.log('Current block number:', await provider.getBlockNumber());
  console.log('Wallet address:', wallet.address);

  const abiPath = path.resolve(
    __dirname,
    '../src/contracts/abi/MockERC20.json',
  );
  const MockERC20Abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

  const token = new ethers.Contract(contractAddress, MockERC20Abi, wallet);

  const isBridgeOperator = await token.bridgeOperators(wallet.address);
  console.log('Is wallet a bridge operator?', isBridgeOperator);

  if (!isBridgeOperator) {
    try {
      console.log('Setting wallet as bridge operator...');
      const setBridgeOperatorTx = await token.setBridgeOperator(
        wallet.address,
        true,
      );
      await setBridgeOperatorTx.wait();
      console.log('Successfully set as bridge operator');
    } catch (error) {
      console.error('Failed to set as bridge operator:', error.message);
      console.log('Make sure the wallet is the contract owner');
    }
  }

  token.on('TokensMinted', (to, amount, event) => {
    console.log('TokensMinted event detected!');
    console.log('  To:', to);
    console.log('  Amount:', ethers.utils.formatEther(amount));
    console.log('  Transaction Hash:', event.transactionHash);
  });

  const mintAmount = ethers.utils.parseEther(amountArg);

  console.log(
    `Calling mint with ${amountArg} tokens to ${recipientAddress} on ${network}...`,
  );
  const mintTx = await token.mint(recipientAddress, mintAmount);
  const receipt = await mintTx.wait();
  console.log('Mint transaction confirmed! Hash:', receipt.transactionHash);

  const tokensMintedEvent = receipt.events?.find(
    (e) => e.event === 'TokensMinted',
  );
  if (tokensMintedEvent) {
    console.log('TokensMinted event found in transaction receipt:');
    console.log('  To:', tokensMintedEvent.args.to);
    console.log(
      '  Amount:',
      ethers.utils.formatEther(tokensMintedEvent.args.amount),
    );
  } else {
    console.log('No TokensMinted event found in transaction receipt');
  }

  const balance = await token.balanceOf(recipientAddress);
  console.log(
    `New Balance for ${recipientAddress}:`,
    ethers.utils.formatEther(balance),
  );

  console.log('Waiting for 5 seconds to catch any events...');
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    console.log('\nUsage: node mint.js [recipient_address] [amount] [network]');
    console.log('  recipient_address: Ethereum address to receive tokens');
    console.log(
      '  amount: Amount of tokens to mint in ETH units (default: 10)',
    );
    console.log(
      '  network: Network to use - "arbitrum" or "optimism" (default: "arbitrum")',
    );
    process.exit(1);
  });
