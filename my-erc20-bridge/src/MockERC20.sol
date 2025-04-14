// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockERC20 is ERC20, Ownable {
    mapping(address => bool) public bridgeOperators;
    
    event TokensBurned(address indexed from, uint256 amount);
    event TokensMinted(address indexed to, uint256 amount);
    event BridgeOperatorUpdated(address operator, bool allowed);

    modifier onlyBridgeOperator() {
        require(bridgeOperators[msg.sender], "Not authorized");
        _;
    }

    constructor(string memory name, string memory symbol) ERC20(name, symbol) Ownable(msg.sender) {}
    
    function setBridgeOperator(address operator, bool allowed) external onlyOwner {
        bridgeOperators[operator] = allowed;
        emit BridgeOperatorUpdated(operator, allowed);
    }
    
    function adminMint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
    
    function mint(address to, uint256 amount) external onlyBridgeOperator {
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }
    
    function burn(address from, uint256 amount) external onlyBridgeOperator {
        _burnWithoutAllowanceCheck(from, amount);
        emit TokensBurned(from, amount);
    }
    
    function _burnWithoutAllowanceCheck(address from, uint256 amount) internal {
        require(from != address(0), "ERC20: burn from the zero address");
        
        if (from != msg.sender) {
            // If burning from another address, we need to check the balance
            uint256 fromBalance = balanceOf(from);
            require(fromBalance >= amount, "ERC20: burn amount exceeds balance");
            _burn(from, amount);
        } else {
            // If burning own tokens, use the standard _burn
            _burn(from, amount);
        }
    }
    
    function addressToString(address addr) internal pure returns (string memory) {
        bytes memory addressBytes = abi.encodePacked(addr);
        bytes memory stringBytes = new bytes(42);
        
        stringBytes[0] = '0';
        stringBytes[1] = 'x';
        
        for (uint256 i = 0; i < 20; i++) {
            uint8 value = uint8(addressBytes[i]);
            uint8 leftNibble = value >> 4;
            uint8 rightNibble = value & 0x0F;
            
            stringBytes[2 + i * 2] = leftNibble < 10 ? bytes1(leftNibble + 48) : bytes1(leftNibble + 87);
            stringBytes[2 + i * 2 + 1] = rightNibble < 10 ? bytes1(rightNibble + 48) : bytes1(rightNibble + 87);
        }
        
        return string(stringBytes);
    }
}
