/** EIP-1193 provider (MetaMask etc.) */
interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  providers?: Array<{ isMetaMask?: boolean }>;
}

interface ChainConfig {
  chainId: string;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

interface ConfigEnv {
  ETH_ADDRESS: string;
  BTCB_ADDRESS: string;
  NPM_ADDRESS: string;
  CHAIN: ChainConfig;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
    ethers?: {
      BrowserProvider: new (provider: EthereumProvider) => unknown;
      Contract: new (address: string, abi: string[], signerOrProvider: unknown) => unknown;
      getAddress: (address: string) => Promise<string>;
    };
  }
}

export {};
