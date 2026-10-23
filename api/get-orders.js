import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const keyword = (req.query.keyword || '').trim();
    const dbId = process.env.DATABASE_ID;                      // 訂單表 ID
    const productDbId = process.env.PRODUCT_DB_ID;              // 主商品表 (B表 / A表) ID
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID; // 款式明細表 (C表) ID

    if (!dbId) {
      return res.status(500).json({ success: false, error: "缺少 DATABASE_ID 環境變數" });
    }

    if (!keyword) {
      return res.status(400).json({ success: false, error: '請輸入查詢的暱稱或聯絡帳號' });
    }

    // 1. 建立主商品表 (B表/A表) ID 到名稱的對照
    let bMapById = {};
    if (productDbId) {
      try {
        const bRes = await notion.databases.query({ database_id: productDbId, page_size: 100 });
        if (bRes && bRes.results) {
          bRes.results.forEach(page => {
            const p = page?.properties || {};
            const titleKey = Object.keys(p).find(k => p[k]?.type === 'title');
            if (titleKey && p[titleKey]?.title && Array.isArray(p[titleKey].title) && p[titleKey].title.length > 0) {
              const name = p[titleKey].title.map(t => t?.plain_text || '').join('').trim();
              if (name) bMapById[page.id] = name;
            }
          });
        }
      } catch (e) {
        console.warn('讀取主商品表失敗:', e.message);
      }
    }

    // 2. 建立款式明細表 (C表) 的圖片字典：嚴格透過「主商品名稱 + 款式名稱」來對應圖片
    let productDict = {};
    if (productDetailDbId) {
      try {
        const cRes = await notion.databases.query({ database_id: productDetailDbId, page_size: 100 });
        if (cRes && cRes.results) {
          cRes.results.forEach(page => {
            const p = page?.properties || {};

            // 抓取關聯到主商品表 (B表) 的 ID
            let parentName = '';
            const relKey = Object.keys(p).find(k => p[k]?.type === 'relation');
            if (relKey && p[relKey]?.relation && Array.isArray(p[relKey].relation) && p[relKey].relation.length > 0) {
              const relId = p[relKey].relation[0]?.id;
              if (relId) parentName = bMapById[relId] || '';
            }

            // 抓取 C 表的款式名稱 (Title)
            let styleName = '標準款式';
            const titleKey = Object.keys(p).find(k => p[k]?.type === 'title');
            if (titleKey && p[titleKey]?.title && Array.isArray(p[titleKey].title) && p[titleKey].title.length > 0) {
              styleName = p[titleKey].title.map(t => t?.plain_text || '').join('').trim() || '標準款式';
            }

            // 抓取 C 表的圖片
            let imageUrl = '';
            const imgKey = Object.keys(p).find(k => k[k]?.type === 'files');
            if (imgKey && p[imgKey]?.files && Array.isArray(p[imgKey].files) && p[imgKey].files.length > 0) {
              const fileObj = p[imgKey].files[0];
              imageUrl = fileObj?.file?.url || fileObj?.external?.url || '';
            }

            if (parentName && imageUrl) {
              productDict[`${parentName}_${styleName}`] = imageUrl;
              productDict[`${parentName}_標準款式`] = imageUrl; // 備用
            }
            if (imageUrl) {
              productDict[styleName] = imageUrl;
            }
          });
        }
      } catch (e) {
        console.warn('讀取款式明細表失敗:', e.message);
      }
    }

    // 3. 查詢 Notion 訂單資料庫
    const response = await notion.databases.query({
      database_id: dbId,
      page_size: 100
    });

    const rawRows = [];

    if (response && response.results) {
      response.results.forEach(page => {
        const p = page?.properties || {};
        
        let nickname = '';
        let contactInfo = '';
        let contactChannel = '';
        let product = '';
        let spec = '標準款式';
        let quantity = 1;
        let totalPrice = 0;
        let delivery = '7-11 店到店';
        let note = '';
        let fulfillmentStatus = '備貨中';
        let paymentStatus = '未付款';
        let imageUrl = '';

        Object.keys(p).forEach(k => {
          const prop = p[k];
          if (!prop) return;
          const lowerKey = k.toLowerCase();

          if (prop.type === 'title' && prop.title && Array.isArray(prop.title) && prop.title.length > 0) {
            nickname = prop.title.map(t => t?.plain_text || '').join('');
          } else if (prop.type === 'rich_text' && prop.rich_text && Array.isArray(prop.rich_text) && prop.rich_text.length > 0) {
            const textVal = prop.rich_text.map(t => t?.plain_text || '').join('');
            
            if (lowerKey.includes('暱稱') || lowerKey.includes('買家') || lowerKey.includes('name')) {
              nickname = textVal || nickname;
            } else if (lowerKey.includes('聯絡帳號') || lowerKey.includes('帳號') || lowerKey.includes('account')) {
              contactInfo = textVal;
            } else if (lowerKey.includes('聯絡方式') || lowerKey.includes('聯絡') || lowerKey.includes('id')) {
              if (!contactInfo) contactInfo = textVal;
            } else if (lowerKey.includes('商品') || lowerKey.includes('品項') || lowerKey === 'product') {
              product = textVal;
            } else if (lowerKey.includes('規格') || lowerKey.includes('款式') || lowerKey.includes('spec')) {
              if (textVal) spec = textVal.trim();
            } else if (lowerKey.includes('備註') || lowerKey.includes('note')) {
              note = textVal;
            }
          } else if (prop.type === 'select' && prop.select?.name) {
            const selectVal = prop.select.name;
            if (lowerKey.includes('取貨') || lowerKey.includes('delivery')) delivery = selectVal;
            if (lowerKey.includes('出貨') || lowerKey.includes('物流')) fulfillmentStatus = selectVal;
            if (lowerKey.includes('付款') || lowerKey.includes('金流')) paymentStatus = selectVal;
            if (lowerKey.includes('規格') || lowerKey.includes('款式') || lowerKey.includes('spec')) spec = selectVal;
            if (lowerKey.includes('管道') || lowerKey.includes('channel')) contactChannel = selectVal;
          } else if (prop.type === 'status' && prop.status?.name) {
            const statusVal = prop.status.name;
            if (lowerKey.includes('出貨') || lowerKey.includes('物流')) fulfillmentStatus = statusVal;
            if (lowerKey.includes('付款') || lowerKey.includes('金流')) paymentStatus = statusVal;
          } else if (prop.type === 'number' && prop.number !== undefined) {
            if (lowerKey.includes('數量') || lowerKey.includes('quantity')) quantity = prop.number || 1;
            if (lowerKey.includes('總金額') || lowerKey.includes('總價') || lowerKey.includes('total') || lowerKey.includes('金額')) {
              totalPrice = prop.number || 0;
            }
          } else if (prop.type === 'files' && prop.files && Array.isArray(prop.files) && prop.files.length > 0) {
            const fileObj = prop.files[0];
            imageUrl = fileObj?.file?.url || fileObj?.external?.url || '';
          }
        });

        // 🎯 嚴格透過「主商品名稱_款式名稱」從 B ➔ C 字典中找出正確圖片
        const dictKey = `${product}_${spec}`;
        if (!imageUrl && productDict[dictKey]) {
          imageUrl = productDict[dictKey];
        } else if (!imageUrl && productDict[`${product}_標準款式`]) {
          imageUrl = productDict[`${product}_標準款式`];
        } else if (!imageUrl && productDict[spec]) {
          imageUrl = productDict[spec];
        } else if (!imageUrl && productDict[product]) {
          imageUrl = productDict[product];
        }

        let fullContact = contactInfo;
        if (contactChannel && contactInfo && !contactInfo.includes(contactChannel)) {
          fullContact = `${contactChannel}: ${contactInfo}`;
        }

        const matchKeyword = keyword.toLowerCase();
        const matchName = nickname.toLowerCase().includes(matchKeyword);
        const matchContact = fullContact.toLowerCase().includes(matchKeyword);

        if (matchName || matchContact) {
          rawRows.push({
            nickname,
            contactInfo: fullContact,
            product: product || '未命名商品',
            spec,
            quantity,
            totalPrice,
            delivery,
            note,
            fulfillmentStatus,
            paymentStatus,
            imageUrl,
            createdAt: page.created_time ? page.created_time.substring(0, 16).replace('T', ' ') : ''
          });
        }
      });
    }

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
