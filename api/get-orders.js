import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const keyword = (req.query.keyword || '').trim();
    const dbId = process.env.DATABASE_ID;                      // 訂單資料庫 ID
    const productDbId = process.env.PRODUCT_DB_ID;              // 主商品 A 表 ID
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID; // 款式明細 C 表 ID

    if (!dbId) {
      return res.status(500).json({ success: false, error: "缺少 DATABASE_ID 環境變數" });
    }

    if (!keyword) {
      return res.status(400).json({ success: false, error: '請輸入查詢的暱稱或聯絡帳號' });
    }

    // 1. 建立 A表（主商品表 ID -> 名稱對照）
    let aMapById = {};
    if (productDbId) {
      try {
        const aRes = await notion.databases.query({ database_id: productDbId, page_size: 100 });
        aRes.results.forEach(page => {
          const p = page.properties || {};
          const titleKey = Object.keys(p).find(k => p[k].type === 'title');
          if (titleKey && p[titleKey]?.title?.[0]) {
            const name = p[titleKey].title.map(t => t.plain_text).join('').trim();
            if (name) aMapById[page.id] = name;
          }
        });
      } catch (e) {
        console.warn('讀取 A 表失敗:', e.message);
      }
    }

    // 2. 建立 C表（款式明細表字典：透過 A表 Relation 抓取對應圖片與規格）
    let productDict = {};
    if (productDetailDbId) {
      try {
        const cRes = await notion.databases.query({ database_id: productDetailDbId, page_size: 100 });
        cRes.results.forEach(page => {
          const p = page.properties || {};

          // 取得 A 表主商品名稱
          let parentName = '';
          const relKey = Object.keys(p).find(k => p[k].type === 'relation');
          if (relKey && p[relKey]?.relation?.length > 0) {
            const relId = p[relKey].relation[0].id;
            parentName = aMapById[relId] || '';
          }

          // 取得款式名稱 (Title)
          let styleName = '標準款式';
          const titleKey = Object.keys(p).find(k => p[k].type === 'title');
          if (titleKey && p[titleKey]?.title?.[0]) {
            styleName = p[titleKey].title.map(t => t.plain_text).join('').trim() || '標準款式';
          }

          // 取得圖片
          let imageUrl = '';
          const imgKey = Object.keys(p).find(k => p[k].type === 'files' || k.includes('圖'));
          if (imgKey && p[imgKey]?.files?.[0]) {
            const fileObj = imgKey.files[0];
            imageUrl = fileObj.file?.url || fileObj.external?.url || '';
          }

          if (parentName) {
            productDict[`${parentName}_${styleName}`] = { imageUrl, styleName };
            productDict[styleName] = { imageUrl, styleName }; // 備用
          }
        });
      } catch (e) {
        console.warn('讀取 C 表字典失敗:', e.message);
      }
    }

    // 3. 查詢 Notion 訂單資料庫
    const response = await notion.databases.query({
      database_id: dbId,
      page_size: 100
    });

    const rawRows = [];

    response.results.forEach(page => {
      const p = page.properties || {};
      
      let nickname = '';
      let contactInfo = '';
      let product = '';
      let spec = '標準款式';
      let quantity = 1;
      let totalPrice = 0;
      let delivery = '7-11 店到店';
      let note = '';
      let fulfillmentStatus = '備貨中';
      let paymentStatus = '未付款';
      let imageUrl = '';

      // 解析訂單各欄位
      Object.keys(p).forEach(k => {
        const prop = p[k];
        const lowerKey = k.toLowerCase();

        if (prop.type === 'title' && prop.title?.[0]) {
          nickname = prop.title.map(t => t.plain_text).join('');
        } else if (prop.type === 'rich_text' && prop.rich_text?.[0]) {
          const textVal = prop.rich_text.map(t => t.plain_text).join('');
          
          if (lowerKey.includes('暱稱') || lowerKey.includes('買家') || lowerKey.includes('name')) {
            nickname = textVal || nickname;
          } else if (lowerKey.includes('聯絡') || lowerKey.includes('帳號') || lowerKey.includes('id')) {
            contactInfo = textVal;
          } else if (lowerKey.includes('商品') || lowerKey.includes('品項') || lowerKey === 'product') {
            product = textVal;
          } else if (lowerKey.includes('規格') || lowerKey.includes('款式') || lowerKey.includes('spec')) {
            if (textVal && textVal.trim() !== '') {
              spec = textVal.trim();
            }
          } else if (lowerKey.includes('備註') || lowerKey.includes('note')) {
            note = textVal;
          }
        } else if (prop.type === 'select' && prop.select?.name) {
          const selectVal = prop.select.name;
          if (lowerKey.includes('取貨') || lowerKey.includes('delivery')) delivery = selectVal;
          if (lowerKey.includes('出貨') || lowerKey.includes('物流')) fulfillmentStatus = selectVal;
          if (lowerKey.includes('付款') || lowerKey.includes('金流')) paymentStatus = selectVal;
        } else if (prop.type === 'status' && prop.status?.name) {
          const statusVal = prop.status.name;
          if (lowerKey.includes('出貨') || lowerKey.includes('物流')) fulfillmentStatus = statusVal;
          if (lowerKey.includes('付款') || lowerKey.includes('金流')) paymentStatus = statusVal;
        } else if (prop.type === 'number') {
          if (lowerKey.includes('數量') || lowerKey.includes('quantity')) quantity = prop.number || 1;
          if (lowerKey.includes('總金額') || lowerKey.includes('總價') || lowerKey.includes('total')) totalPrice = prop.number || 0;
        } else if (prop.type === 'files') {
          if (prop.files?.[0]) {
            const fileObj = prop.files[0];
            imageUrl = fileObj.file?.url || fileObj.external?.url || '';
          }
        }
      });

      // 🎯 透過 A 表與 C 表字典精準對應圖片
      const dictKey1 = `${product}_${spec}`;
      if (!imageUrl && productDict[dictKey1]) {
        imageUrl = productDict[dictKey1].imageUrl;
      } else if (!imageUrl && productDict[spec]) {
        imageUrl = productDict[spec].imageUrl;
      }

      const matchKeyword = keyword.toLowerCase();
      const matchName = nickname.toLowerCase().includes(matchKeyword);
      const matchContact = contactInfo.toLowerCase().includes(matchKeyword);

      if (matchName || matchContact) {
        rawRows.push({
          nickname,
          contactInfo,
          product: product || '未命名商品',
          spec: spec,
          quantity: quantity,
          totalPrice: totalPrice,
          delivery,
          note,
          fulfillmentStatus,
          paymentStatus,
          imageUrl,
          createdAt: page.created_time ? page.created_time.substring(0, 16).replace('T', ' ') : ''
        });
      }
    });

    // 依下單時間群組化
    const groupedOrdersMap = {};

    rawRows.forEach(row => {
      const timeKey = row.createdAt; 
      if (!groupedOrdersMap[timeKey]) {
        groupedOrdersMap[timeKey] = {
          nickname: row.nickname,
          contactInfo: row.contactInfo,
          delivery: row.delivery,
          note: row.note,
          fulfillmentStatus: row.fulfillmentStatus,
          paymentStatus: row.paymentStatus,
          createdAt: row.createdAt,
          items: [],
          grandTotal: 0,
          unpaidTotal: 0
        };
      }

      groupedOrdersMap[timeKey].items.push({
        product: row.product,
        spec: row.spec,
        quantity: row.quantity,
        price: row.totalPrice,
        imageUrl: row.imageUrl
      });

      groupedOrdersMap[timeKey].grandTotal += row.totalPrice;

      if (!row.paymentStatus.includes('已付款') && !row.paymentStatus.includes('結清')) {
        groupedOrdersMap[timeKey].unpaidTotal += row.totalPrice;
      }
    });

    const orders = Object.values(groupedOrdersMap);

    return res.status(200).json({ success: true, orders });

  } catch (error) {
    console.error("Query Orders Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
