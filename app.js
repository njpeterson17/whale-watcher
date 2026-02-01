// Whale Watcher - Crypto Large Transaction Monitor
// Tracks Bitcoin and Ethereum whale transactions with 24-hour history

const API_MEMPOOL = 'https://mempool.space/api';
const API_BINANCE = 'https://data-api.binance.vision/api/v3';
// Public Ethereum RPC endpoint (no API key needed)
const API_ETH_RPC = 'https://eth.llamarpc.com';

const STORAGE_KEYS = {
    btc: 'whale_watcher_btc_txs',
    eth: 'whale_watcher_eth_txs'
};
const HISTORY_HOURS = 24;

// Transaction size thresholds
const THRESHOLDS = {
    btc: {
        MEGA: 5,
        LARGE: 2,
        MEDIUM: 1,
        SMALL: 0.5,
        TINY: 0.1
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
    if (!addr || addr.length < 20) return addr || 'Unknown';
    return `${addr.slice(0, 8)}...${addr.slice(-8)}`;
}

function getTxCategory(crypto, amount) {
    const t = THRESHOLDS[crypto];
    if (amount >= t.MEGA) return 'mega';
    if (amount >= t.LARGE) return 'large';
    if (amount >= t.MEDIUM) return 'medium';
    if (amount >= t.SMALL) return 'small';
    if (crypto === 'eth') return 'shrimp';
    return 'tiny';
}

function getCategoryIcon(category) {
    const icons = { mega: '🐋', large: '🦈', medium: '🐡', small: '🐟', tiny: '🐠', shrimp: '🦐' };
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
        if (!response.ok) throw new Error('Price API error');
        const data = await response.json();
        btcPrice = parseFloat(data.price);
        getEl('btcPrice').textContent = formatFullUSD(btcPrice);
        return true;
    } catch (error) {
        console.error('Error fetching BTC price:', error);
        if (btcPrice === 0) btcPrice = 100000; // Fallback
        getEl('btcPrice').textContent = btcPrice > 0 ? formatFullUSD(btcPrice) : 'Error';
        return false;
    }
}

async function fetchETHPrice() {
    try {
        const response = await fetch(`${API_BINANCE}/ticker/price?symbol=ETHUSDT`);
        if (!response.ok) throw new Error('Price API error');
        const data = await response.json();
        ethPrice = parseFloat(data.price);
        getEl('ethPrice').textContent = formatFullUSD(ethPrice);
        return true;
    } catch (error) {
        console.error('Error fetching ETH price:', error);
        if (ethPrice === 0) ethPrice = 3500; // Fallback
        getEl('ethPrice').textContent = ethPrice > 0 ? formatFullUSD(ethPrice) : 'Error';
        return false;
    }
}

// Bitcoin transaction fetching using Mempool.space API
async function fetchBTCTransactions(blockCount = 5) {
    const allWhaleTxs = [];

    try {
        // Get latest block height
        updateLoadingProgress('btc', 0, blockCount, 'Getting latest block...');
        console.log('Fetching BTC block height from mempool.space...');
        const heightResponse = await fetch(`${API_MEMPOOL}/blocks/tip/height`);
        console.log('BTC height response status:', heightResponse.status);
        if (!heightResponse.ok) throw new Error('Failed to get block height');
        const latestHeight = await heightResponse.json();
        console.log('Latest BTC block height:', latestHeight);

        // Fetch recent blocks
        for (let i = 0; i < blockCount; i++) {
            const height = latestHeight - i;
            updateLoadingProgress('btc', i + 1, blockCount, `Scanning block ${height}...`);

            try {
                // Get block hash
                const hashResponse = await fetch(`${API_MEMPOOL}/block-height/${height}`);
                if (!hashResponse.ok) continue;
                const blockHash = await hashResponse.text();

                // Get block info for timestamp
                const blockResponse = await fetch(`${API_MEMPOOL}/block/${blockHash}`);
                if (!blockResponse.ok) continue;
                const block = await blockResponse.json();
                const blockTime = block.timestamp;

                // Get block transactions (first page - 25 txs)
                const txResponse = await fetch(`${API_MEMPOOL}/block/${blockHash}/txs`);
                if (!txResponse.ok) continue;
                const blockTxs = await txResponse.json();

                console.log(`BTC Block ${height}: ${blockTxs.length} transactions`);

                // Process transactions
                let whalesInBlock = 0;
                for (const tx of blockTxs) {
                    // Calculate total output value
                    const totalOutput = tx.vout.reduce((sum, out) => sum + (out.value || 0), 0);
                    const btcAmount = totalOutput / 100000000;

                    if (btcAmount >= THRESHOLDS.btc.TINY) {
                        whalesInBlock++;
                        // Find largest output address
                        const largestOut = tx.vout.reduce((max, out) =>
                            (out.value || 0) > (max.value || 0) ? out : max, tx.vout[0]);

                        // Find input address
                        const fromAddr = tx.vin[0]?.prevout?.scriptpubkey_address || 'Coinbase';

                        allWhaleTxs.push({
                            hash: tx.txid,
                            time: blockTime,
                            amount: btcAmount,
                            usd: btcAmount * btcPrice,
                            category: getTxCategory('btc', btcAmount),
                            to: largestOut.scriptpubkey_address || 'Unknown',
                            from: fromAddr,
                            crypto: 'btc',
                            confirmed: true
                        });
                    }
                }
                console.log(`  -> Found ${whalesInBlock} whale txs (>= ${THRESHOLDS.btc.TINY} BTC)`);

                // Small delay to avoid rate limiting
                await new Promise(r => setTimeout(r, 200));

            } catch (blockError) {
                console.error(`Error fetching block ${height}:`, blockError);
            }
        }

        // Also fetch recent mempool transactions
        try {
            const mempoolResponse = await fetch(`${API_MEMPOOL}/mempool/recent`);
            if (mempoolResponse.ok) {
                const mempoolTxs = await mempoolResponse.json();
                for (const tx of mempoolTxs) {
                    const btcAmount = tx.value / 100000000;
                    if (btcAmount >= THRESHOLDS.btc.TINY) {
                        allWhaleTxs.push({
                            hash: tx.txid,
                            time: Math.floor(Date.now() / 1000),
                            amount: btcAmount,
                            usd: btcAmount * btcPrice,
                            category: getTxCategory('btc', btcAmount),
                            to: 'Mempool',
                            from: 'Mempool',
                            crypto: 'btc',
                            confirmed: false
                        });
                    }
                }
            }
        } catch (e) {
            console.error('Error fetching mempool:', e);
        }

        // Deduplicate
        const uniqueTxs = allWhaleTxs.filter((tx, index, self) =>
            index === self.findIndex(t => t.hash === tx.hash)
        );
        return uniqueTxs.sort((a, b) => b.time - a.time);

    } catch (error) {
        console.error('Error fetching BTC transactions:', error);
        throw error;
    }
}

// Ethereum transaction fetching using public RPC
async function fetchETHTransactions() {
    const whaleTxs = [];

    try {
        // Get latest block number via JSON-RPC
        updateLoadingProgress('eth', 0, 10, 'Getting latest ETH block...');
        console.log('Fetching ETH block number from:', API_ETH_RPC);

        const blockNumResponse = await fetch(API_ETH_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_blockNumber',
                params: [],
                id: 1
            })
        });

        console.log('ETH block response status:', blockNumResponse.status);

        if (!blockNumResponse.ok) {
            throw new Error(`RPC error: ${blockNumResponse.status}`);
        }

        const blockNumData = await blockNumResponse.json();
        console.log('ETH block response:', blockNumData);

        if (blockNumData.error) {
            throw new Error(`RPC error: ${blockNumData.error.message}`);
        }

        if (!blockNumData.result) {
            throw new Error('No block number in response');
        }

        const latestBlock = parseInt(blockNumData.result, 16);
        console.log('Latest ETH block:', latestBlock);

        // Fetch last 10 blocks
        for (let i = 0; i < 10; i++) {
            const blockNum = latestBlock - i;
            updateLoadingProgress('eth', i + 1, 10, `Scanning ETH block ${blockNum}...`);

            try {
                const response = await fetch(API_ETH_RPC, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'eth_getBlockByNumber',
                        params: ['0x' + blockNum.toString(16), true],
                        id: blockNum
                    })
                });

                if (!response.ok) {
                    console.error(`Failed to fetch ETH block ${blockNum}`);
                    continue;
                }

                const data = await response.json();

                if (data.error) {
                    console.error(`RPC error for block ${blockNum}:`, data.error);
                    continue;
                }

                if (data.result && data.result.transactions) {
                    const blockTime = parseInt(data.result.timestamp, 16);
                    console.log(`Block ${blockNum}: ${data.result.transactions.length} transactions, time: ${new Date(blockTime * 1000).toISOString()}`);

                    let whalesInBlock = 0;
                    for (const tx of data.result.transactions) {
                        const ethAmount = parseInt(tx.value, 16) / 1e18;

                        if (ethAmount >= THRESHOLDS.eth.SHRIMP) {
                            whalesInBlock++;
                            const category = getTxCategory('eth', ethAmount);

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
                    console.log(`  -> Found ${whalesInBlock} whale txs (>= ${THRESHOLDS.eth.SHRIMP} ETH)`);
                } else {
                    console.log(`Block ${blockNum}: No transactions in response`, data);
                }

                // Small delay between requests
                await new Promise(r => setTimeout(r, 100));

            } catch (e) {
                console.error(`Error fetching ETH block ${blockNum}:`, e);
            }
        }

        console.log(`Found ${whaleTxs.length} ETH whale transactions`);

    } catch (error) {
        console.error('Error fetching ETH transactions:', error);
        showError('eth', `Failed to fetch Ethereum data: ${error.message}`);
    }

    const uniqueTxs = whaleTxs.filter((tx, index, self) =>
        index === self.findIndex(t => t.hash === tx.hash)
    );
    return uniqueTxs.sort((a, b) => b.time - a.time);
}

// UI functions
function updateLoadingProgress(crypto, current, total, message = null) {
    const feedEl = getEl(`${crypto}-transactionFeed`);
    const loadingEl = feedEl?.querySelector('.loading-state p');
    if (loadingEl) {
        loadingEl.textContent = message || `Scanning blocks... ${current}/${total}`;
    }
}

function showError(crypto, message) {
    const feedEl = getEl(`${crypto}-transactionFeed`);
    if (feedEl) {
        feedEl.innerHTML = `
            <div class="empty-state">
                <div class="icon">⚠️</div>
                <h3>Error Loading Data</h3>
                <p>${message}</p>
                <button onclick="initCrypto('${crypto}')" style="margin-top: 15px; padding: 10px 20px; cursor: pointer;">Retry</button>
            </div>
        `;
    }
}

function createTransactionCard(tx, isNew = false) {
    const card = document.createElement('div');
    card.className = `tx-card ${tx.category} ${isNew ? 'new' : ''}`;
    card.dataset.category = tx.category;

    const explorerUrl = tx.crypto === 'btc'
        ? `https://mempool.space/tx/${tx.hash}`
        : `https://etherscan.io/tx/${tx.hash}`;

    const amountUnit = tx.crypto === 'btc' ? 'BTC' : 'ETH';
    const confirmedBadge = tx.confirmed === false ? '<span class="unconfirmed">⏳</span>' : '';

    card.innerHTML = `
        <div class="tx-icon">${getCategoryIcon(tx.category)}</div>
        <div class="tx-info">
            <a href="${explorerUrl}" target="_blank" class="tx-hash">${truncateAddress(tx.hash)}</a>
            <span class="tx-time">${timeAgo(tx.time)} ${confirmedBadge}</span>
            <div class="tx-addresses">
                <span class="from" title="${tx.from}">From: ${truncateAddress(tx.from)}</span>
                <span class="arrow">→</span>
                <span class="to" title="${tx.to}">To: ${truncateAddress(tx.to)}</span>
            </div>
        </div>
        <div class="tx-amount">
            <span class="tx-crypto">${tx.amount.toFixed(4)} ${amountUnit}</span>
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

    const megaEl = getEl(`${crypto}-megaCount`);
    const largeEl = getEl(`${crypto}-largeCount`);
    const mediumEl = getEl(`${crypto}-mediumCount`);
    const smallEl = getEl(`${crypto}-smallCount`);

    if (megaEl) megaEl.textContent = mega.length;
    if (largeEl) largeEl.textContent = large.length;
    if (mediumEl) mediumEl.textContent = medium.length;
    if (smallEl) smallEl.textContent = small.length;

    // Tiny count for BTC
    if (crypto === 'btc') {
        const tiny = recentTxs.filter(t => t.category === 'tiny');
        const tinyEl = getEl(`${crypto}-tinyCount`);
        if (tinyEl) tinyEl.textContent = tiny.length;
    }

    // Shrimp count for ETH
    if (crypto === 'eth') {
        const shrimp = recentTxs.filter(t => t.category === 'shrimp');
        const shrimpEl = getEl(`${crypto}-shrimpCount`);
        if (shrimpEl) shrimpEl.textContent = shrimp.length;
    }

    const totalVol = recentTxs.reduce((sum, t) => sum + t.usd, 0);
    const volEl = getEl(`${crypto}-totalVolume`);
    if (volEl) volEl.textContent = formatUSD(totalVol);
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
    console.log(`Initializing ${crypto.toUpperCase()}...`);

    // Show loading state
    const feedEl = getEl(`${crypto}-transactionFeed`);
    feedEl.innerHTML = `
        <div class="loading-state">
            <div class="sonar"></div>
            <p>Scanning the blockchain for whales...</p>
        </div>
    `;

    if (crypto === 'btc') {
        await fetchBTCPrice();
        transactions.btc = loadTransactions('btc');

        if (transactions.btc.length > 0) {
            // Update USD values with current price
            transactions.btc = transactions.btc.map(t => ({
                ...t,
                usd: t.amount * btcPrice
            }));
            renderTransactions('btc');
            updateStats('btc');
        }

        try {
            const blockCount = transactions.btc.length === 0 ? 10 : 3;
            const newTxs = await fetchBTCTransactions(blockCount);
            isInitialLoad.btc = false;
            mergeTransactions('btc', newTxs);
            renderTransactions('btc');
            updateStats('btc');
        } catch (error) {
            console.error('BTC init error:', error);
            if (transactions.btc.length === 0) {
                showError('btc', 'Failed to load Bitcoin data. The API may be temporarily unavailable.');
            }
        }

        setupFilters('btc');

    } else {
        await fetchETHPrice();
        transactions.eth = loadTransactions('eth');

        if (transactions.eth.length > 0) {
            // Update USD values with current price
            transactions.eth = transactions.eth.map(t => ({
                ...t,
                usd: t.amount * ethPrice
            }));
            renderTransactions('eth');
            updateStats('eth');
        }

        try {
            const newTxs = await fetchETHTransactions();
            isInitialLoad.eth = false;
            mergeTransactions('eth', newTxs);
            renderTransactions('eth');
            updateStats('eth');
        } catch (error) {
            console.error('ETH init error:', error);
            if (transactions.eth.length === 0) {
                showError('eth', 'Failed to load Ethereum data. The API may be temporarily unavailable.');
            }
        }

        setupFilters('eth');
    }

    updateLastScan();
}

// Main initialization
async function init() {
    console.log('Whale Watcher initializing...');
    setupTabs();

    // Initialize Bitcoin first
    await initCrypto('btc');

    // Pre-fetch ETH price in background
    fetchETHPrice();
}

// Auto-refresh every 60 seconds
setInterval(async () => {
    console.log(`Refreshing ${currentCrypto.toUpperCase()} data...`);

    if (currentCrypto === 'btc') {
        await fetchBTCPrice();
        transactions.btc = transactions.btc.map(t => ({ ...t, usd: t.amount * btcPrice }));

        try {
            const newTxs = await fetchBTCTransactions(2);
            if (mergeTransactions('btc', newTxs) > 0) {
                renderTransactions('btc');
            }
            updateStats('btc');
        } catch (e) {
            console.error('BTC refresh error:', e);
        }
    } else {
        await fetchETHPrice();
        transactions.eth = transactions.eth.map(t => ({ ...t, usd: t.amount * ethPrice }));

        try {
            const newTxs = await fetchETHTransactions();
            if (mergeTransactions('eth', newTxs) > 0) {
                renderTransactions('eth');
            }
            updateStats('eth');
        } catch (e) {
            console.error('ETH refresh error:', e);
        }
    }

    updateLastScan();
}, 60000);

// Debug function - run testAPIs() in browser console to test
window.testAPIs = async function() {
    console.log('=== Testing APIs ===');

    // Test Mempool.space
    console.log('\n1. Testing Mempool.space (BTC)...');
    try {
        const btcRes = await fetch('https://mempool.space/api/blocks/tip/height');
        const btcHeight = await btcRes.json();
        console.log('✓ Mempool.space working! Latest block:', btcHeight);
    } catch (e) {
        console.error('✗ Mempool.space failed:', e.message);
    }

    // Test Ethereum RPC
    console.log('\n2. Testing Ethereum RPC...');
    try {
        const ethRes = await fetch('https://eth.llamarpc.com', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_blockNumber',
                params: [],
                id: 1
            })
        });
        const ethData = await ethRes.json();
        console.log('ETH RPC response:', ethData);
        if (ethData.result) {
            console.log('✓ ETH RPC working! Latest block:', parseInt(ethData.result, 16));
        } else {
            console.error('✗ ETH RPC error:', ethData.error || ethData);
        }
    } catch (e) {
        console.error('✗ ETH RPC failed:', e.message);
    }

    // Test Binance prices
    console.log('\n3. Testing Binance (prices)...');
    try {
        const priceRes = await fetch('https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT');
        const priceData = await priceRes.json();
        console.log('✓ Binance working! BTC price:', priceData.price);
    } catch (e) {
        console.error('✗ Binance failed:', e.message);
    }

    console.log('\n=== Tests complete ===');
};

// Start
init();
