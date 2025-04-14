const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

export const initiateBridge = async (
  recipient: string,
  amount: string,
  sourceNetwork: string,
  targetNetwork: string
): Promise<any> => {
  const response = await fetch(`${API_BASE_URL}/bridge/bridge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient,
      amount,
      sourceNetwork,
      targetNetwork,
    }),
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'Failed to bridge tokens');
  }
  
  return response.json();
};
