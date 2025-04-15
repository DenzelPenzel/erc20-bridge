// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../lib/relay-context-contracts/contracts/vendor/ERC2771Context.sol";

contract BridgeToken is ERC20, Ownable, ERC2771Context {
    struct BurnRecord {
        uint256 amount;
        bool processed;
    }
    mapping(address => bool) public bridgeOperators;    
    mapping(bytes32 => BurnRecord) public burnRecords;
    
    event TokensBurned(address indexed from, uint256 amount, bytes32 indexed burnId);
    event TokensMinted(address indexed to, uint256 amount, bytes32 indexed burnId);
    event BridgeOperatorUpdated(address operator, bool allowed);
    event DebugMsgSender(address sender, address rawSender, bytes msgData);
    
    modifier onlyBridgeOperator() {
        address sender = _msgSender();
        address rawSender = msg.sender;
        emit DebugMsgSender(sender, rawSender, msg.data);        
        require(bridgeOperators[sender], "BridgeToken: caller is not a bridge operator");
        _;
    }

    constructor(
        string memory name, 
        string memory symbol,
        address trustedForwarder
    ) 
        ERC20(name, symbol) 
        Ownable(msg.sender)
        ERC2771Context(trustedForwarder)
    {}
    
    function setBridgeOperator(address operator, bool allowed) external onlyOwner {
        bridgeOperators[operator] = allowed;
        emit BridgeOperatorUpdated(operator, allowed);
    }
    
    function adminMint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
        emit TokensMinted(to, amount, bytes32(0));
    }
    
    function mint(
        address to, 
        uint256 amount,
        bytes32 burnId
    ) external onlyBridgeOperator {
        require(!burnRecords[burnId].processed, "BridgeToken: burn ID already processed");
        require(burnId != bytes32(0), "BridgeToken: invalid burn ID");
        
        burnRecords[burnId].processed = true;
        
        // Mint the tokens
        _mint(to, amount);
        
        emit TokensMinted(to, amount, burnId);
    }
    
    function burn(
        address from, 
        uint256 amount
    ) external onlyBridgeOperator returns (bytes32 burnId) {
        burnId = keccak256(abi.encodePacked(
            from,
            amount,
            block.number,
            block.timestamp,
            address(this)
        ));
        
        // Burn the tokens
        _burnWithoutAllowanceCheck(from, amount);
        
        // Emit event with burn ID for tracking by the bridge
        emit TokensBurned(from, amount, burnId);
    }
    
    function _burnWithoutAllowanceCheck(address from, uint256 amount) internal {
        require(from != address(0), "BridgeToken: burn from the zero address");
        
        uint256 fromBalance = balanceOf(from);
        require(fromBalance >= amount, "BridgeToken: burn amount exceeds balance");
        
        _burn(from, amount);
    }
    
    /**
     * @dev Override for _msgSender() to support meta-transactions
     */
    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }
    
    /**
     * @dev Override for _msgData() to support meta-transactions
     */
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }
}
