import { Client } from '@notionhq/client';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const notionToken = process.env.NOTION_TOKEN;
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID; // 規格/明細表 C表
    const productDbId = process.env.PRODUCT_DB_ID || process.env.DATABASE_ID; // 主商品表 A表

    if (!notionToken || !productDetailDbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 Notion 環境變數' });
    }

    const notion = new Client({ auth: notionToken });

    // 1. 建立主商品 A 表對照字典
    let aMapById = {};
    if (productDbId) {
      try {
        const aRes = await notion.databases.query({ database_id: productDbId });
        aRes.results.forEach(page => {
          const p = page.properties;
          const nameProp = p['商品名稱'] || p['名稱'] || p['Name'];
          const name = nameProp?.title?.[0]?.plain_text || nameProp?.rich_text?.[0]?.plain_text || '';
          if (name) aMapById[page.id] = name;
        });
      } catch (e) {
        console.log('查詢主商品表失敗:', e.message);
      }
    }

    // 2. 查詢規格明細 C 表（取得款式、價格、圖片）
    const cRes = await notion.databases.query({ database_id: productDetailDbId });
    const products = [];

    cRes.results.forEach(page => {
      const p = page.properties;

      // 取得款式名稱
      const titleProp = p['款式名稱'] || p['名稱'] || p['Name'];
      const styleName = titleProp?.title?.[0]?.plain_text || titleProp?.rich_text?.[0]?.plain_text || '標準款式';

      // 取得所屬主商品名稱
      let parentName = '';
      const prodProp = p['商品名稱'] || p['商品'];
      if (prodProp) {
        if (prodProp.type === 'relation' && prodProp.relation.length > 0) {
          const relId = prodProp.relation[0].id;
          parentName = aMapById[relId] || '';
        } else if (prodProp.type === 'select') {
          parentName = prodProp.select?.name || '';
        } else if (prodProp.type === 'rich_text') {
          parentName = prodProp.rich_text?.[0]?.plain_text || '';
        } else if (prodProp.type === 'title') {
          parentName = prodProp.title?.[0]?.plain_text || '';
        }
      }

      // 取得價格
      const priceProp = p['價格'] || p['單價'] || p['Price'];
      const price = priceProp?.number || 0;

      // 取得圖片
      const imgProp = p['款式圖片'] || p['圖片'] || p['Files'];
      let imageUrl = '';
      if (imgProp?.files?.[0]) {
        const fileObj = imgProp.files[0];
        imageUrl = fileObj.file?.url || fileObj.external?.url || '';
      }

      if (parentName) {
        products.push({
          productName: parentName,
          styleName: styleName,
          price: price,
          imageUrl: imageUrl
        });
      }
    });

    return res.status(200).json({ success: true, products });

  } catch (error) {
    console.error("Get Products Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
