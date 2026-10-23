import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// 輔助函式：發送 Telegram 通知
async function sendTelegramNotification(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
    });
  } catch (error) {
    console.error('Telegram 發送失敗:', error);
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

    // 🎯 直接建立對應 Notion 欄位的 properties 物件
    // 💡 提示：如果您的 Notion 欄位名稱不同，請把雙引號內的字串改成您 Notion 裡真正的欄位名稱
    const properties = {
      "商品名稱": { // Title 欄位
        title: [{ text: { content: product } }]
      },
      "聯絡人": { // 依您的 Notion 實際欄位調整 (rich_text)
        rich_text: [{ text: { content: contact } }]
      }
    };

    // 如果前端有傳 location，寫入 Notion 的「採購地點」欄位 (請確認 Notion 欄位型態為 Rich Text)
    if (location) {
      properties["採購地點"] = {
        rich_text: [{ text: { content: String(location) } }]
      };
    }

    // 如果前端有傳 budget，寫入 Notion 的「預算」欄位 (請確認 Notion 欄位型態為 Number，若為文字請改 rich_text)
    if (budget !== undefined && budget !== '') {
      properties["預算"] = {
        number: parseFloat(budget) || 0
      };
    }

    // 1. 寫入 Notion
    await notion.pages.create({
      parent: { database_id: wishDbId },
      properties: properties
    });

    // 2. 發送 Telegram 通知
    const tgMessage = 
      `✨ <b>收到新的商品許願！</b>\n\n` +
      `📦 <b>想許願商品：</b> ${product}\n` +
      `👤 <b>聯絡人：</b> ${contact}\n` +
      `🌍 <b>採購地點：</b> ${location || '未指定'}\n` +
      `💰 <b>預算：</b> ${budget ? '$' + budget : '未填寫'}`;

    await sendTelegramNotification(tgMessage);

    return res.status(200).json({ success: true, message: '許願成功並已發送通知' });

  } catch (error) {
    console.error("Wish Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
