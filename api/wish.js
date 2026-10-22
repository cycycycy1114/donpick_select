import { Client } from '@notionhq/client';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const notionToken = process.env.NOTION_TOKEN;
    const dbId = process.env.WISH_DATABASE_ID || process.env.DATABASE_ID;

    if (!notionToken || !dbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 Notion 環境變數' });
    }

    const notion = new Client({ auth: notionToken });
    const { nickname, contactInfo, productName, location, budget } = req.body;

    if (!productName) {
      return res.status(400).json({ success: false, error: '請填寫想許願的商品名稱' });
    }

    // 1. 寫入 Notion 資料庫
    await notion.pages.create({
      parent: { database_id: dbId },
      properties: {
        "買家暱稱": { title: [{ text: { content: nickname || '匿名許願者' } }] },
        "聯絡方式": { rich_text: [{ text: { content: contactInfo || '未填寫' } }] },
        "商品名稱": { rich_text: [{ text: { content: `✨ [許願] ${productName}` } }] },
        "規格款式": { rich_text: [{ text: { content: `地點：${location || '未指定'} | 預算：${budget || '無上限'}` } }] },
        "備註": { rich_text: [{ text: { content: '粉絲許願單' } }] }
      }
    });

    // 2. 🎯 發送 Telegram 通知
    const tgToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (tgToken && chatId) {
      const tgMessage = `✨ 【收到新的粉絲許願！】\n\n👤 暱稱/聯絡：${nickname || '未填寫'}\n🎯 商品：${productName}\n📍 地點：${location || '未指定'}\n💰 預算：${budget || '無上限'}`;
      await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: tgMessage })
      });
    }

    return res.status(200).json({ success: true, message: '許願成功！' });

  } catch (error) {
    console.error("Wish API Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
