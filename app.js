// Whale Watcher - Crypto Large Transaction Monitor
// Tracks Bitcoin and Ethereum whale transactions with 24-hour history

const API_BLOCKCHAIN = 'https://blockchain.info';
const API_BINANCE = 'https://data-api.binance.vision/api/v3';
const API_ETHERSCAN = 'https://api.etherscan.io/api';

// Etherscan API key - free tier allows 5 calls/sec
const ETHERSCAN_API_KEY = 'W8YE213HG1FTZ7C26F4R9YHGM1ZTN9KTTS';

const STORAGE_KEYS = {
    btc: 'whale_watcher_btc_txs',
    eth: 'whale_watcher_eth_txs'
};
const HISTORY_HOURS = 24;

// Transaction size thresholds
const THRESHOLDS = {
    btc: {
        MEGA: 1000,
        LARGE: 100,
        MEDIUM: 10,
        SMALL: 1
    },
    eth: {
        MEGA: 10000,
        LARGE: 1000,
        MEDIUM: 100,
        SMALL: 10,
        SHRIMP: 1
    }
};

// State
let currentCrypto = 'btc';
let btcPrice = 0;
let ethPrice = 0;
let transactions = {
    btc: [],
    eth: []
};
let currentFilter = {
    btc: 'all',
    eth: 'all'
};
let isInitialLoad = {
    btc: true,
    eth: true
};

// DOM Element getters
const getEl = (id) => document.getElementById(id);

// Format helpers
function formatBTC(satoshis) {
    return (satoshis / 100000000).toFixed(4);
}

function formatETH(wei) {
    return (wei / 1e18).toFixed(4);
}

function formatUSD(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 2
    }).format(amount);
}

function formatFullUSD(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() / 1000) - timestamp);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

function truncateAddress(addr) {
    if (!addr || addr.length < 20) return addr;
    return `${addr.slice(0, 8)}...${addr.slice(-8)}`;
}

function getTxCategory(crypto, amount) {
    const t = THRESHOLDS[crypto];
    if (amount >= t.MEGA) return 'mega';
    if (amount >= t.LARGE) return 'large';
    if (amount >= t.MEDIUM) return 'medium';
    if (amount >= t.SMALL) return 'small';
    return crypto === 'eth' ? 'shrimp' : 'small';
}

function getCategoryIcon(category) {
    const icons = { mega: '🐋', large: '🦈', medium: '🐟', small: '🐠', shrimp: '🦐' };
    return icons[category] || '🐠';
}

// Storage functions
function saveTransactions(crypto) {
    try {
        const cutoff = (Date.now() / 1000) - (HISTORY_HOURS * 3600);
        const recentTxs = transactions[crypto].filter(t => t.time > cutoff);
        localStorage.setItem(STORAGE_KEYS[crypto], JSON.stringify({
            transactions: recentTxs.slice(0, 500),
            savedAt: Date.now()
        }));
    } catch (e) {
        console.error(`Error saving ${crypto} transactions:`, e);
    }
}

function loadTransactions(crypto) {
    try {
        const saved = localStorage.getItem(STORAGE_KEYS[crypto]);
        if (saved) {
            const { transactions: txs } = JSON.parse(saved);
            const cutoff = (Date.now() / 1000) - (HISTORY_HOURS * 3600);
            return txs.filter(t => t.time > cutoff);
        }
    } catch (e) {
        console.error(`Error loading ${crypto} transactions:`, e);
    }
    return [];
}

// Price fetching
async function fetchBTCPrice() {
    try {
        const response = await fetch(`${API_BINANCE}/ticker/price?symbol=BTCUSDT`);
        const data = await response.json();
        btcPrice = parseFloat(data.price);
        getEl('btcPrice').textContent = formatFullUSD(btcPrice);
    } catch (error) {
        console.error('Error fetching BTC price:', error);
        getEl('btcPrice').textContent = 'Error';
    }
}

async function fetchETHPrice() {
    try {
        const response = await fetch(`${API_BINANCE}/ticker/price?symbol=ETHUSDT`);
        const data = await response.json();
        ethPrice = parseFloat(data.price);
        getEl('ethPrice').textContent = formatFullUSD(ethPrice);
    } catch (error) {
        console.error('Error fetching ETH price:', error);
        getEl('ethPrice').textContent = 'Error';
    }
}

// Bitcoin transaction fetching
async function fetchBTCBlocks(count = 5) {
    try {
        const latestResponse = await fetch(`${API_BLOCKCHAIN}/latestblock`);
        const latest = await latestResponse.json();
        const blocks = [];
        let currentHash = latest.hash;

        for (let i = 0; i < count; i++) {
            try {
                const blockResponse = await fetch(`${API_BLOCKCHAIN}/rawblock/${currentHash}`);
                const block = await blockResponse.json();
                blocks.push({ hash: block.hash, height: block.height, time: block.time, tx: block.tx });
                currentHash = block.prev_block;
                if (isInitialLoad.btc) {
                    updateLoadingProgress('btc', i + 1, count);
                }
                await new Promise(r => setTimeout(r, 300));
            } catch (e) {
                console.error('Error fetching BTC block:', e);
                break;
            }
        }
        return blocks;
    } catch (error) {
        console.error('Error fetching BTC blocks:', error);
        return [];
    }
}

function processBTCTransaction(tx, blockTime) {
    const whaleOutputs = [];
    if (!tx.out) return whaleOutputs;

    let totalOutput = 0;
    tx.out.forEach(output => { totalOutput += output.value; });
    const btcAmount = totalOutput / 100000000;

    if (btcAmount >= THRESHOLDS.btc.SMALL) {
        const category = getTxCategory('btc', btcAmount);
        const largestOutput = tx.out.reduce((max, output) =>
            output.value > max.value ? output : max, tx.out[0]);
        const inputs = tx.inputs ? tx.inputs.map(inp =>
            inp.prev_out ? inp.prev_out.addr : null
        ).filter(Boolean) : [];

        whaleOutputs.push({
            hash: tx.hash,
            time: tx.time || blockTime,
            amount: btcAmount,
            usd: btcAmount * btcPrice,
            category: category,
            to: largestOutput.addr || 'Unknown',
            from: inputs[0] || 'Unknown',
            crypto: 'btc'
        });
    }
    return whaleOutputs;
}

async function fetchBTCTransactions(blockCount = 5) {
    const blocks = await fetchBTCBlocks(blockCount);
    const allWhaleTxs = [];

    for (const block of blocks) {
        if (block.tx) {
            for (const tx of block.tx) {
                const whaleTxs = processBTCTransaction(tx, block.time);
                allWhaleTxs.push(...whaleTxs);
            }
        }
    }

    const uniqueTxs = allWhaleTxs.filter((tx, index, self) =>
        index === self.findIndex(t => t.hash === tx.hash)
    );
    return uniqueTxs.sort((a, b) => b.time - a.time);
}

// Ethereum transaction fetching (using Etherscan)
async function fetchETHTransactions() {
    const whaleTxs = [];
    
    try {
        // Get latest block number
        const blockNumResponse = await fetch(
            `${API_ETHERSCAN}?module=proxy&action=eth_blockNumber&apikey=${ETHERSCAN_API_KEY}`
        );
        const blockNumData = await blockNumResponse.json();
        const latestBlock = parseInt(blockNumData.result, 16);

        // Fetch last 10 blocks
        for (let i = 0; i < 10; i++) {
            const blockNum = latestBlock - i;
            try {
                const response = await fetch(
                    `${API_ETHERSCAN}?module=proxy&action=eth_getBlockByNumber&tag=0x${blockNum.toString(16)}&boolean=true&apikey=${ETHERSCAN_API_KEY}`
                );
                const data = await response.json();
                
                if (data.result && data.result.transactions) {
                    for (const tx of data.result.transactions) {
                        const ethAmount = parseInt(tx.value, 16) / 1e18;
                        
                        if (ethAmount >= THRESHOLDS.eth.SHRIMP) {
                            const category = getTxCategory('eth', ethAmount);
                            const blockTime = parseInt(data.result.timestamp, 16);
                            
                            whaleTxs.push({
                                hash: tx.hash,
                                time: blockTime,
                                amount: ethAmount,
                                usd: ethAmount * ethPrice,
                                category: category,
                                to: tx.to || 'Contract Creation',
                                from: tx.from,
                                crypto: 'eth',
                                gasPrice: parseInt(tx.gasPrice, 16) / 1e9
                            });
                        }
                    }
                }
                
                if (isInitialLoad.eth) {
                    updateLoadingProgress('eth', i + 1, 10);
                }
                await new Promise(r => setTimeout(r, 200));
            } catch (e) {
                console.error('Error fetching ETH block:', e);
            }
        }
    } catch (error) {
        console.error('Error fetching ETH transactions:', error);
    }

    const uniqueTxs = whaleTxs.filter((tx, index, self) =>
        index === self.findIndex(t => t.hash === tx.hash)
    );
    return uniqueTxs.sort((a, b) => b.time - a.time);
}

// UI functions
function updateLoadingProgress(crypto, current, total) {
    const feedEl = getEl(`${crypto}-transactionFeed`);
    const loadingEl = feedEl.querySelector('.loading-state p');
    if (loadingEl) {
        loadingEl.textContent = `Scanning blocks... ${current}/${total}`;
    }
}

function createTransactionCard(tx, isNew = false) {
    const card = document.createElement('div');
    card.className = `tx-card ${tx.category} ${isNew ? 'new' : ''}`;
    card.dataset.category = tx.category;

    const explorerUrl = tx.crypto === 'btc'
        ? `https://www.blockchain.com/explorer/transactions/btc/${tx.hash}`
        : `https://etherscan.io/tx/${tx.hash}`;

    const amountUnit = tx.crypto === 'btc' ? 'BTC' : 'ETH';

    card.innerHTML = `
        <div class="tx-icon">${getCategoryIcon(tx.category)}</div>
        <div class="tx-info">
            <a href="${explorerUrl}" target="_blank" class="tx-hash">${truncateAddress(tx.hash)}</a>
            <span class="tx-time">${timeAgo(tx.time)}</span>
            <div class="tx-addresses">
                <span class="from" title="${tx.from}">From: ${truncateAddress(tx.from)}</span>
                <span class="arrow">→</span>
                <span class="to" title="${tx.to}">To: ${truncateAddress(tx.to)}</span>
            </div>
        </div>
        <div class="tx-amount">
            <span class="tx-crypto">${tx.amount.toFixed(2)} ${amountUnit}</span>
            <span class="tx-usd">${formatUSD(tx.usd)}</span>
        </div>
        <span class="tx-badge ${tx.category}">${tx.category}</span>
    `;

    return card;
}

function updateStats(crypto) {
    const cutoff = (Date.now() / 1000) - (HISTORY_HOURS * 3600);
    const recentTxs = transactions[crypto].filter(t => t.time > cutoff);

    const mega = recentTxs.filter(t => t.category === 'mega');
    const large = recentTxs.filter(t => t.category === 'large');
    const medium = recentTxs.filter(t => t.category === 'medium');
    const small = recentTxs.filter(t => t.category === 'small');

    getEl(`${crypto}-megaCount`).textContent = mega.length;
    getEl(`${crypto}-largeCount`).textContent = large.length;
    getEl(`${crypto}-mediumCount`).textContent = medium.length;
    getEl(`${crypto}-smallCount`).textContent = small.length;

    // Shrimp count for ETH
    if (crypto === 'eth') {
        const shrimp = recentTxs.filter(t => t.category === 'shrimp');
        const shrimpEl = getEl(`${crypto}-shrimpCount`);
        if (shrimpEl) shrimpEl.textContent = shrimp.length;
    }

    const totalVol = recentTxs.reduce((sum, t) => sum + t.usd, 0);
    if (getEl(`${crypto}-totalVolume`)) {
        getEl(`${crypto}-totalVolume`).textContent = formatUSD(totalVol);
    }
}

function renderTransactions(crypto) {
    const cutoff = (Date.now() / 1000) - (HISTORY_HOURS * 3600);
    let filtered = transactions[crypto].filter(t => t.time > cutoff);

    if (currentFilter[crypto] !== 'all') {
        filtered = filtered.filter(t => t.category === currentFilter[crypto]);
    }

    const feedEl = getEl(`${crypto}-transactionFeed`);

    if (filtered.length === 0) {
        feedEl.innerHTML = `
            <div class="empty-state">
                <div class="icon">🌊</div>
                <h3>No whales spotted</h3>
                <p>No ${currentFilter[crypto]} transactions found in the last 24 hours</p>
            </div>
        `;
        return;
    }

    feedEl.innerHTML = '';
    filtered.slice(0, 100).forEach(tx => {
        feedEl.appendChild(createTransactionCard(tx, false));
    });
}

function mergeTransactions(crypto, newTxs) {
    const existingHashes = new Set(transactions[crypto].map(t => t.hash));
    const actuallyNew = newTxs.filter(t => !existingHashes.has(t.hash));

    if (actuallyNew.length > 0) {
        transactions[crypto] = [...actuallyNew, ...transactions[crypto]];
        transactions[crypto].sort((a, b) => b.time - a.time);
        const cutoff = (Date.now() / 1000) - (HISTORY_HOURS * 3600);
        transactions[crypto] = transactions[crypto].filter(t => t.time > cutoff);
        saveTransactions(crypto);
    }

    return actuallyNew.length;
}

function setupFilters(crypto) {
    const buttons = document.querySelectorAll(`#${crypto}-filters .filter-btn`);
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter[crypto] = btn.dataset.filter;
            renderTransactions(crypto);
        });
    });
}

function updateLastScan() {
    const btcCount = transactions.btc.length;
    const ethCount = transactions.eth.length;
    getEl('lastUpdate').textContent = `Last scan: ${new Date().toLocaleTimeString()} | BTC: ${btcCount} | ETH: ${ethCount}`;
}

// Tab switching
function setupTabs() {
    const tabs = document.querySelectorAll('.crypto-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const crypto = tab.dataset.crypto;
            
            // Update tab styles
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Show/hide views
            document.querySelectorAll('.crypto-view').forEach(view => {
                view.classList.remove('active');
            });
            getEl(`${crypto}-view`).classList.add('active');
            
            currentCrypto = crypto;
            
            // Initialize if first time
            if (isInitialLoad[crypto] && transactions[crypto].length === 0) {
                initCrypto(crypto);
            }
        });
    });
}

// Initialization for each crypto
async function initCrypto(crypto) {
    if (crypto === 'btc') {
        await fetchBTCPrice();
        transactions.btc = loadTransactions('btc');
        if (transactions.btc.length > 0) {
            renderTransactions('btc');
            updateStats('btc');
        }
        const blockCount = transactions.btc.length === 0 ? 15 : 5;
        const newTxs = await fetchBTCTransactions(blockCount);
        isInitialLoad.btc = false;
        mergeTransactions('btc', newTxs);
        renderTransactions('btc');
        updateStats('btc');
        setupFilters('btc');
    } else {
        await fetchETHPrice();
        transactions.eth = loadTransactions('eth');
        if (transactions.eth.length > 0) {
            renderTransactions('eth');
            updateStats('eth');
        }
        const newTxs = await fetchETHTransactions();
        isInitialLoad.eth = false;
        mergeTransactions('eth', newTxs);
        renderTransactions('eth');
        updateStats('eth');
        setupFilters('eth');
    }
    updateLastScan();
}

// Main initialization
async function init() {
    setupTabs();
    
    // Initialize Bitcoin first
    await initCrypto('btc');
    
    // Pre-fetch ETH price in background
    fetchETHPrice();
}

// Auto-refresh
setInterval(async () => {
    if (currentCrypto === 'btc') {
        await fetchBTCPrice();
        transactions.btc = transactions.btc.map(t => ({ ...t, usd: t.amount * btcPrice }));
        const newTxs = await fetchBTCTransactions(3);
        if (mergeTransactions('btc', newTxs) > 0) {
            renderTransactions('btc');
        }
        updateStats('btc');
    } else {
        await fetchETHPrice();
        transactions.eth = transactions.eth.map(t => ({ ...t, usd: t.amount * ethPrice }));
        const newTxs = await fetchETHTransactions();
        if (mergeTransactions('eth', newTxs) > 0) {
            renderTransactions('eth');
        }
        updateStats('eth');
    }
    updateLastScan();
}, 60000);

// Start
init();
