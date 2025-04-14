import { MintTokensRequest } from '../types/transaction';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export const mintTokens = async (mintRequest: MintTokensRequest): Promise<any> => {
  try {
    const response = await fetch(`${API_BASE_URL}/mint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mintRequest),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to mint tokens');
  }
};
