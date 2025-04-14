const { ethers } = require('ethers');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('Using RPC:', process.env.RPC_ARBITRUMSEPOLIA);
  console.log('Contract address:', process.env.ARBITRUM_ERC20_ADDRESS);

  const provider = new ethers.providers.JsonRpcProvider(
    process.env.RPC_ARBITRUMSEPOLIA,
  );
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contractAddress = process.env.ARBITRUM_ERC20_ADDRESS;

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

  token.on('TokensBurned', (from, amount, event) => {
    console.log('TokensBurned event detected!');
    console.log('  From:', from);
    console.log('  Amount:', ethers.utils.formatEther(amount));
    console.log('  Transaction Hash:', event.transactionHash);
  });

  const initialBalance = await token.balanceOf(wallet.address);
  console.log('Initial Balance:', ethers.utils.formatEther(initialBalance));

  const burnAmount = ethers.utils.parseEther('0.01');

  if (initialBalance.lt(burnAmount)) {
    console.error('Not enough tokens to burn. Please mint some tokens first.');
    return;
  }

  console.log('Calling burn...');
  const burnTx = await token.burn(wallet.address, burnAmount);
  const receipt = await burnTx.wait();
  console.log('Burn transaction confirmed! Hash:', receipt.transactionHash);

  const tokensBurnedEvent = receipt.events?.find(
    (e) => e.event === 'TokensBurned',
  );
  if (tokensBurnedEvent) {
    console.log('TokensBurned event found in transaction receipt:');
    console.log('  From:', tokensBurnedEvent.args.from);
    console.log(
      '  Amount:',
      ethers.utils.formatEther(tokensBurnedEvent.args.amount),
    );
  } else {
    console.log('No TokensBurned event found in transaction receipt');
  }

  const finalBalance = await token.balanceOf(wallet.address);
  console.log('New Balance:', ethers.utils.formatEther(finalBalance));
  console.log(
    'Burned Amount:',
    ethers.utils.formatEther(initialBalance.sub(finalBalance)),
  );

  console.log('Waiting for 5 seconds to catch any events...');
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
