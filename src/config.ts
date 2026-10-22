import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

export const CHAIN_ID = 50383 as const;
export const chain = hidekiTestnet;
export const RPC_URL = 'https://api.hideki2.infra.testnet.somnia.network';
export const WS_URL = 'wss://api.hideki2.infra.testnet.somnia.network/ws';
export const INDEXER_URL = 'https://hideki-dev.smk.somnia.host/v1/graphql';

export function assertTestnet(chainId: number): void {
  if (chainId !== CHAIN_ID) throw new Error(`Expected testnet ${CHAIN_ID}, got ${chainId}`);
}
