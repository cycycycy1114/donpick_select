import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { nickname, contactType, contactInfo, delivery, items } = req.body || {};
    const dbId = process.env.DATABASE_ID;

    if (!dbId) {
      return res.status(500).json({ success: false, error: "缺少 DATABASE_ID 環境變數" });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: '購物車是空的或資料格式錯誤' });
    }

    const dbInfo = await notion.databases.retrieve({ database_id: dbId });
    const propsSchema = dbInfo.properties;

    const setProp = (propertiesObj, possibleNames, val, overrideType = null) => {
      const propKey = Object.keys(propsSchema).find(k =>
        possibleNames.some(p => k.trim().toLowerCase() === p.trim().toLowerCase())
      );

      if (!propKey) return;

      const propType = overrideType || propsSchema[propKey].type;
      const strVal = String(val !== undefined && val !== null ? val : '');

      if (propType === 'title') {
        propertiesObj[propKey] = { title: [{ text: { content: strVal || '未命名買家' } }] };
      } else if (propType === 'rich_text') {
        propertiesObj[propKey] = { rich_text: [{ text: { content: strVal } }] };
      } else if (propType === 'select') {
        if (strVal) propertiesObj[propKey] = { select: { name: strVal } };
      } else if (propType === 'status') {
        if (strVal) propertiesObj[propKey] = { status: { name: strVal } };
      } else if (propType === 'number') {
        propertiesObj[propKey] = { number: Number(val) || 0 };
      }
    };

    let totalGrandPrice = 0;
    let summaryItemsText = '';

    // 迴圈將購物車多筆商品分別寫入 Notion
    for (const item of items) {
      const properties = {};

      setProp(properties, ['買家暱稱', '訂單', '訂單名稱', '暱稱', 'LINE社群暱稱', 'Name', 'Title'], nickname || '未命名買家');
      setProp(properties, ['聯絡管道', '聯絡方式', '聯絡型態', '管道'], contactType);
      setProp(properties, ['聯絡資訊', '聯絡帳號', 'LINE ID/IG', '帳號', '聯絡內容'], contactInfo);
      setProp(properties, ['商品名稱', '商品', '品項', '預購商品', 'Product'], item.product);
      setProp(properties, ['規格', '款式', 'Spec'], item.spec);
      setProp(properties, ['數量', '購買數量', 'Quantity'], item.quantity);
      setProp(properties, ['單價', '價格', 'Price'], item.price);
      setProp(properties, ['總金額', '總價', '合計', 'Total Price', '金額'], item.totalPrice);
      setProp(properties, ['取貨方式', '寄送方式', '物流', 'Delivery'], delivery);
      
      setProp(properties, ['物流狀態', '出貨狀態'], '備貨中');
      setProp(properties, ['金流狀態', '付款狀態'], '未付款');

      const titleKey = Object.keys(propsSchema).find(k => propsSchema[k].type === 'title');
      if (titleKey && !properties[titleKey]) {
        properties[titleKey] = { title: [{ text: { content: nickname || '未命名訂單' } }] };
      }

      await notion.pages.create({
        parent: { database_id: dbId },
        properties: properties
      });

      totalGrandPrice += item.totalPrice;
      summaryItemsText += `• ${item.product} (${item.spec}) x ${item.quantity} ($${item.totalPrice})\n`;
    }

    // 發送 Telegram 即時通知
    try {
      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

      if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        const message = `🚨 **新購物車訂單成立！**\n` +
                        `------------------\n` +
                        `👤 買家：${nickname || '未命名'}\n` +
                        `📱 聯絡：[${contactType}] ${contactInfo}\n` +
                        `🚚 取貨：${delivery || '未填寫'}\n` +
                        `💰 總金額：$ ${totalGrandPrice}\n` +
                        `------------------\n` +
                        `📦 購買品項：\n${summaryItemsText}`;

        const tgUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await fetch(tgUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: message
          })
        });
      }
    } catch (tgError) {
      console.error("發送 Telegram 通知失敗:", tgError);
    }

    return res.status(200).json({ success: true, message: 'Success' });

  } catch (error) {
    console.error("Notion 寫入詳細錯誤:", error);
    const errorMsg = error.body ? JSON.stringify(error.body) : (error.message || String(error));
    return res.status(500).json({ success: false, error: errorMsg });
  }
}
