export type Transaction = { id: string; type: "topup" | "purchase"; tokens: number; status: "success" | "failed"; createdAt: string };
export type Wallet = { tokenBalance: number; monthlyTokenLimit: number; monthlyUsage: number; plan: "free" | "basic" | "pro"; requests: number[]; transactions: Transaction[] };
const key = "agentfa-wallet";
const base: Wallet = { tokenBalance: 50000, monthlyTokenLimit: 50000, monthlyUsage: 0, plan: "free", requests: [], transactions: [] };
export const getWallet = (): Wallet => JSON.parse(localStorage.getItem(key) || JSON.stringify(base));
const save = (wallet: Wallet) => localStorage.setItem(key, JSON.stringify(wallet));
export type SendCheck = { ok: boolean; code?: "rate" | "balance" };
export function canSend(estimated: number): SendCheck { const w=getWallet(); const now=Date.now(); const requests=w.requests.filter(t=>now-t<86400000); const minute=requests.filter(t=>now-t<60000).length; const hour=requests.filter(t=>now-t<3600000).length; if(minute>=20||hour>=100||requests.length>=500)return {ok:false,code:"rate"}; if(w.tokenBalance<estimated||w.monthlyUsage+estimated>w.monthlyTokenLimit)return {ok:false,code:"balance"}; return {ok:true}; }
export function recordUsage(tokens:number){const w=getWallet();w.tokenBalance=Math.max(0,w.tokenBalance-tokens);w.monthlyUsage+=tokens;w.requests=[...w.requests.filter(t=>Date.now()-t<86400000),Date.now()];save(w);return w}
export function topUp(tokens:number){const w=getWallet();w.tokenBalance+=tokens;w.transactions.unshift({id:crypto.randomUUID(),type:"topup",tokens,status:"success",createdAt:new Date().toISOString()});save(w);return w}
export function choosePlan(plan: Wallet["plan"], limit: number){const w=getWallet();w.plan=plan;w.monthlyTokenLimit=limit;w.tokenBalance=Math.max(w.tokenBalance,limit);w.transactions.unshift({id:crypto.randomUUID(),type:"purchase",tokens:limit,status:"success",createdAt:new Date().toISOString()});save(w);return w}
