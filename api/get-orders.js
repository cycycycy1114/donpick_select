import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const keyword = (req.query.keyword || '').trim();
    const dbId = process.env.DATABASE_ID; // 預定訂單表的 Database ID

    if (!dbId) {
      return res.status(500).json({ success: false, error: "缺少 DATABASE_ID 環境變數" });
    }

    if (!keyword) {
      return res.status(400).json({ success: false, error: '請輸入查詢的暱稱或聯絡帳號' });
    }

    // 查詢 Notion 訂單資料庫
    const response = await notion.databases.query({
      database_id: dbId,
      page_size: 50
    });

    const orders = [];

    response.results.forEach(page => {
      const p = page.properties || {};
      
      let nickname = '';
      let contactInfo = '';
      let product = '';
      let spec = '';
      let quantity = 0;
      let totalPrice = 0;
      let delivery = '';
      let note = '';
      let fulfillmentStatus = '備貨中';
      let paymentStatus = '未付款';

      // 智慧比對各欄位
      Object.keys(p).forEach(k => {
        const prop = p[k];
        const lowerKey = k.toLowerCase();

        if (prop.type === 'title' && prop.title?.[0]) {
          nickname = prop.title.map(t => t.plain_text).join('');
        } else if (prop.type === 'rich_text' && prop.rich_text?.[0]) {
          const textVal = prop.rich_text.map(t => t.plain_text).join('');
          if (lowerKey.includes('暱稱') || lowerKey.includes('買家') || lowerKey.includes('name')) nickname = textVal || nickname;
          if (lowerKey.includes('聯絡') || lowerKey.includes('帳號') || lowerKey.includes('id')) contactInfo = textVal;
          if (lowerKey.includes('商品') || lowerKey.includes('品項') || lowerKey.includes('product')) product = textVal;
          if (lowerKey.includes('規格') || lowerKey.includes('款式') || lowerKey.includes('spec')) spec = textVal;
          if (lowerKey.includes('備註') || lowerKey.includes('許願') || lowerKey.includes('note')) note = textVal;
        } else if (prop.type === 'select' && prop.select?.name) {
          const selectVal = prop.select.name;
          if (lowerKey.includes('取貨') || lowerKey.includes('物流') || lowerKey.includes('delivery')) delivery = selectVal;
          if (lowerKey.includes('出貨') || lowerKey.includes('物流狀態')) fulfillmentStatus = selectVal;
          if (lowerKey.includes('付款') || lowerKey.includes('金流')) paymentStatus = selectVal;
        } else if (prop.type === 'status' && prop.status?.name) {
          const statusVal = prop.status.name;
          if (lowerKey.includes('出貨') || lowerKey.includes('物流')) fulfillmentStatus = statusVal;
          if (lowerKey.includes('付款') || lowerKey.includes('金流')) paymentStatus = statusVal;
        } else if (prop.type === 'number') {
          if (lowerKey.includes('數量') || lowerKey.includes('quantity')) quantity = prop.number || 0;
          if (lowerKey.includes('總金額') || lowerKey.includes('總價') || lowerKey.includes('total')) totalPrice = prop.number || 0;
        }
      });

      // 檢查是否符合買家輸入的關鍵字 (模糊比對暱稱或聯絡帳號)
      const matchKeyword = keyword.toLowerCase();
      const matchName = nickname.toLowerCase().includes(matchKeyword);
      const matchContact = contactInfo.toLowerCase().includes(matchKeyword);

      if (matchName || matchContact) {
        orders.push({
          nickname,
          contactInfo,
          product: product || '未命名商品',
          spec: spec || '標準款式',
          quantity: quantity || 1,
          totalPrice: totalPrice || 0,
          delivery: delivery || '未填寫',
          note: note || '',
          fulfillmentStatus,
          paymentStatus,
          createdAt: page.created_time ? page.created_time.substring(0, 10) : ''
        });
      }
    });

    return res.status(200).json({ success: true, orders });

  } catch (error) {
    console.error("Query Orders Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
