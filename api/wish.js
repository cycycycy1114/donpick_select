import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// 輔助函式：發送 Telegram 通知
async function sendTelegramNotification(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.warn('Telegram 設定不完整（缺少 TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID），已略過通知');
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML' // 支援 HTML 排版
      })
    });

    const data = await response.json();
    if (!data.ok) {
      console.error('Telegram 發送失敗:', data.description);
    }
  } catch (error) {
    console.error('Telegram 網路請求錯誤:', error);
  }
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const wishDbId = process.env.WISH_DATABASE_ID || process.env.WISH_DB_ID;
    if (!wishDbId) {
      return res.status(500).json({ success: false, error: '未設定 WISH_DATABASE_ID 環境變數' });
    }

    const { contact, product, location, budget } = req.body;
    if (!contact || !product) {
      return res.status(400).json({ success: false, error: '請填寫聯絡人與想許願的商品' });
    }

    // 1. 自動讀取 Notion 許願資料庫的 Schema 結構
    const dbInfo = await notion.databases.retrieve({ database_id: wishDbId });
    const schema = dbInfo.properties || {};

    // 2. 自動尋找對應欄位名稱的輔助函式
    const findPropKey = (keywords) => {
      for (const k of Object.keys(schema)) {
        const lk = k.trim().toLowerCase();
        for (const kw of keywords) {
          if (lk.includes(kw.toLowerCase())) return k;
        }
      }
      return null;
    };

    const titleKey = Object.keys(schema).find(k => schema[k].type === 'title');
    if (!titleKey) {
      return res.status(500).json({ success: false, error: 'Notion 許願資料庫中找不到 Title (標題) 欄位' });
    }

    const contactKey = findPropKey(['聯絡', '暱稱', 'contact', 'name']);
    const locKey = findPropKey(['地點', '國家', 'location', '地方', '地區']);
    const budgetKey = findPropKey(['預算', '價格', 'budget', 'price']);

    const properties = {};

    // 寫入商品名稱 (Title)
    properties[titleKey] = {
      title: [{ text: { content: product } }]
    };

    // 寫入聯絡人
    if (contactKey && schema[contactKey]) {
      const type = schema[contactKey].type;
      if (type === 'rich_text') {
        properties[contactKey] = { rich_text: [{ text: { content: contact } }] };
      } else if (type === 'select') {
        properties[contactKey] = { select: { name: contact } };
      }
    }

    // 寫入地點
    if (location && locKey && schema[locKey]) {
      const type = schema[locKey].type;
      if (type === 'rich_text') {
        properties[locKey] = { rich_text: [{ text: { content: String(location) } }] };
      } else if (type === 'select') {
        properties[locKey] = { select: { name: String(location) } };
      }
    }

    // 寫入預算
    if (budget !== undefined && budget !== '' && budgetKey && schema[budgetKey]) {
      const type = schema[budgetKey].type;
      if (type === 'number') {
        properties[budgetKey] = { number: parseFloat(budget) || 0 };
      } else if (type === 'rich_text') {
        properties[budgetKey] = { rich_text: [{ text: { content: String(budget) } }] };
      }
    }

    // 3. 寫入 Notion 資料庫
    await notion.pages.create({
      parent: { database_id: wishDbId },
      properties: properties
    });

    // 4. 🎯 成功寫入後，發送 Telegram 通知
    const tgMessage = 
      `✨ <b>收到新的商品許願！</b>\n\n` +
      `📦 <b>想許願商品：</b> ${product}\n` +
      `👤 <b>聯絡人：</b> ${contact}\n` +
      `🌍 <b>採購地點：</b> ${location || '未指定'}\n` +
      `💰 <b>預算：</b> ${budget ? '$' + budget : '未填寫'}`;

    await sendTelegramNotification(tgMessage);

    return res.status(200).json({ success: true, message: '許願成功並已發送通知' });

  } catch (error) {
    console.error("Wish API Error Detail:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
