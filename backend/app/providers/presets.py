from __future__ import annotations

PRESET_POOLS: dict[str, dict] = {
    "beginner_etf": {
        "id": "beginner_etf",
        "name": "新手首选 · 高流动性宽基 ETF",
        "description": "无个股暴雷与财报跳空风险，买卖价差极窄（通常仅 $0.01-$0.03），最适合刚入场练习",
        "symbols": ["SPY", "QQQ", "IWM", "DIA", "SCHD", "TLT", "GLD"],
    },
    "blue_chip": {
        "id": "blue_chip",
        "name": "美股核心蓝筹 · 巨头收租池",
        "description": "护城河深厚、期权流动性全市场顶尖的科技与消费龙头，适合牛市看跌价差或打折接股",
        "symbols": ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "JPM", "KO"],
    },
    "small_account": {
        "id": "small_account",
        "name": "小资金友好 · 低股价稳健池 ($20-$100)",
        "description": "单手正股担保金额较低（$2,500-$9,000），适合 $5k-$15k 账户做 Cash-Secured Put 或 Covered Call",
        "symbols": ["KO", "SCHD", "CSCO", "BAC", "PFE", "F", "TLT", "GDX"],
    },
}

TICKER_META: dict[str, tuple[str, str]] = {
    "SPY": ("SPDR 标普500 ETF", "宽基指数 ETF"),
    "QQQ": ("Invesco 纳斯达克100 ETF", "科技宽基 ETF"),
    "IWM": ("iShares 罗素2000 ETF", "中小盘宽基 ETF"),
    "DIA": ("SPDR 道琼斯工业 ETF", "蓝筹指数 ETF"),
    "SCHD": ("Schwab 美国红利股票 ETF", "高股息防御 ETF"),
    "TLT": ("iShares 20年期以上美债 ETF", "国债利率 ETF"),
    "GLD": ("SPDR 黄金 ETF", "贵金属避险 ETF"),
    "GDX": ("VanEck 黄金矿业 ETF", "贵金属行业 ETF"),
    "AAPL": ("Apple 苹果", "消费电子/科技巨头"),
    "MSFT": ("Microsoft 微软", "云计算/AI 巨头"),
    "GOOGL": ("Alphabet 谷歌", "互联网/AI 巨头"),
    "AMZN": ("Amazon 亚马逊", "电商/云计算巨头"),
    "NVDA": ("NVIDIA 英伟达", "AI 算力龙头"),
    "META": ("Meta Platforms", "社交/AI 巨头"),
    "JPM": ("JPMorgan 摩根大通", "金融银行龙头"),
    "KO": ("Coca-Cola 可口可乐", "必选消费防御"),
    "CSCO": ("Cisco 思科", "网络设备高息蓝筹"),
    "BAC": ("Bank of America 美国银行", "大型商业银行"),
    "PFE": ("Pfizer 辉瑞", "医药高股息"),
    "F": ("Ford 福特汽车", "传统汽车高流动性"),
}
