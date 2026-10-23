import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// 輔助函式：發送 Telegram 通知
async function sendTelegramNotification(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.warn('Telegram 設定不完整，已略過通知');
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
        parse_mode: 'HTML' // 支援 HTML 語法排版
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
    const dbId = process.env.DATABASE_ID; // 訂單表 ID
    if (!dbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 DATABASE_ID 環境變數' });
    }

    const { nickname, contactType, contactInfo, delivery, note, items } = req.body;

    if (!nickname || !contactInfo || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: '訂單資料不完整' });
    }

    let grandTotal = 0;
    const itemDetailsText = [];

    // 逐筆將購物車品項寫入 Notion 訂單資料庫
    for (const item of items) {
      const productTitle = item.product || '';
      const specName = item.spec || '標準款式';
      const quantity = item.quantity || 1;
      const totalPrice = item.totalPrice || 0;
      grandTotal += totalPrice;

      itemDetailsText.push(`• <b>${productTitle}</b> / 規格：${specName} x ${quantity} ($${totalPrice})`);

      const properties = {
        "買家暱稱": {
          title: [{ text: { content: nickname } }]
        },
        "聯絡方式": {
          rich_text: [{ text: { content: `${contactType}: ${contactInfo}` } }]
        },
        "商品名": {
          rich_text: [{ text: { content: productTitle } }]
        },
        "規格": {
          select: { name: specName } // 根據您的 Notion 設定：規格為 select
        },
        "數量": {
          number: quantity
        },
        "總金額": {
          number: totalPrice
        },
        "取貨方式": {
          select: { name: delivery || '7-11 店到店' }
        },
        "備註": {
          rich_text: [{ text: { content: note || '' } }]
        },
        "出貨狀態": {
          status: { name: '備貨中' }
        },
        "付款狀態": {
          status: { name: '未付款' }
        }
      };

      // 如果有圖片網址，一併寫入 Notion 的「款式圖片」欄位
      if (item.imageUrl) {
        properties["款式圖片"] = {
          files: [{
            name: "product_image.jpg",
            external: { url: item.imageUrl }
          }]
        };
      }

      await notion.pages.create({
        parent: { database_id: dbId },
        properties: properties
      });
    }

    // 🎯 訂單全部寫入成功後，發送 Telegram 通知
    const tgMessage = 
      `🛒 <b>收到新的客戶訂單！</b>\n\n` +
      `👤 <b>買家暱稱：</b> ${nickname}\n` +
      `📞 <b>聯絡方式：</b> ${contactType}: ${contactInfo}\n` +
      `🚚 <b>取貨方式：</b> ${delivery || '7-11 店到店'}\n` +
      `💰 <b>訂單總金額：</b> $${grandTotal}\n` +
      `📝 <b>備註：</b> ${note || '無'}\n\n` +
      `📦 <b>採購品項明細：</b>\n` + itemDetailsText.join('\n');

    await sendTelegramNotification(tgMessage);

    return res.status(200).json({ success: true, message: '訂單建立成功並已發送通知' });

  } catch (error) {
    console.error("Create Order Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
