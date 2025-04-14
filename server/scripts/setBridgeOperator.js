const { ethers } = require('ethers');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function main() {
  const operatorAddress = process.argv[2];
  if (!operatorAddress) {
    console.error(
      'Please provide an operator address as a command line argument',
    );
    console.log('Usage: node setBridgeOperator.js <operatorAddress>');
    return;
  }

  if (!ethers.utils.isAddress(operatorAddress)) {
    console.error('Invalid Ethereum address format');
    return;
  }

  const network = process.argv[3] || 'arbitrum';
  const rpcUrl =
    network.toLowerCase() === 'optimism'
      ? process.env.RPC_OPSEPOLIA
      : process.env.RPC_ARBITRUMSEPOLIA;
  const contractAddress =
    network.toLowerCase() === 'optimism'
      ? process.env.OPTIMISM_ERC20_ADDRESS
      : process.env.ARBITRUM_ERC20_ADDRESS;

  console.log(`Using network: ${network}`);
  console.log(`Using RPC: ${rpcUrl}`);
  console.log(`Contract address: ${contractAddress}`);

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

  const contractOwner = await token.owner();
  console.log('Contract owner:', contractOwner);

  if (contractOwner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error(
      'The wallet is not the contract owner. Only the owner can set bridge operators.',
    );
    return;
  }

  const isBridgeOperator = await token.bridgeOperators(operatorAddress);
  console.log(
    `Is ${operatorAddress} already a bridge operator?`,
    isBridgeOperator,
  );

  if (isBridgeOperator) {
    console.log('Address is already set as a bridge operator.');
    return;
  }

  try {
    console.log(`Setting ${operatorAddress} as bridge operator...`);
    const setBridgeOperatorTx = await token.setBridgeOperator(
      operatorAddress,
      true,
    );
    console.log('Transaction hash:', setBridgeOperatorTx.hash);

    console.log('Waiting for transaction confirmation...');
    const receipt = await setBridgeOperatorTx.wait();

    console.log('Transaction confirmed in block:', receipt.blockNumber);
    console.log('Gas used:', receipt.gasUsed.toString());
    console.log('Successfully set as bridge operator');

    const isNowBridgeOperator = await token.bridgeOperators(operatorAddress);
    console.log(
      `Is ${operatorAddress} now a bridge operator?`,
      isNowBridgeOperator,
    );
  } catch (error) {
    console.error('Failed to set as bridge operator:', error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
