import { Client } from '@notionhq/client';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const notionToken = process.env.NOTION_TOKEN;
    const productDbId = process.env.PRODUCT_DB_ID || process.env.DATABASE_ID;       // 主商品表 A表
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID;                   // 款式明細表 C表

    if (!notionToken || !productDbId || !productDetailDbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定完整的 Notion 資料庫環境變數 (PRODUCT_DB_ID / PRODUCT_DETAIL_DB_ID)' });
    }

    const notion = new Client({ auth: notionToken });

    // 1. 查詢主商品 A表，建立 ID 對應名稱的字典
    const aRes = await notion.databases.query({ database_id: productDbId });
    let aMapById = {};
    
    aRes.results.forEach(page => {
      const p = page.properties;
      // 自動尋找 A 表中可能是標題的欄位
      const titleKey = Object.keys(p).find(k => p[k].type === 'title');
      if (titleKey && p[titleKey].title?.[0]) {
        const name = p[titleKey].title.map(t => t.plain_text).join('');
        if (name) {
          aMapById[page.id] = name;
        }
      }
    });

    // 2. 查詢款式明細 C表
    const cRes = await notion.databases.query({ database_id: productDetailDbId });
    const products = [];

    cRes.results.forEach(page => {
      const p = page.properties;

      // 取得款式名稱 (優先找 title 或 rich_text)
      let styleName = '標準款式';
      const styleKey = Object.keys(p).find(k => p[k].type === 'title' || (k.includes('款式') && p[k].type === 'rich_text'));
      if (styleKey) {
        if (p[styleKey].type === 'title') {
          styleName = p[styleKey].title.map(t => t.plain_text).join('') || '標準款式';
        } else if (p[styleKey].type === 'rich_text') {
          styleName = p[styleKey].rich_text.map(t => t.plain_text).join('') || '標準款式';
        }
      }

      // 取得所屬主商品名稱（支援 relation 或是直接填寫的 text/select）
      let parentName = '';
      const prodKey = Object.keys(p).find(k => k.includes('商品') || k.includes('主商品') || p[k].type === 'relation');
      
      if (prodKey) {
        const prop = p[prodKey];
        if (prop.type === 'relation' && prop.relation.length > 0) {
          const relId = prop.relation[0].id;
          parentName = aMapById[relId] || '';
        } else if (prop.type === 'select') {
          parentName = prop.select?.name || '';
        } else if (prop.type === 'rich_text') {
          parentName = prop.rich_text.map(t => t.plain_text).join('') || '';
        } else if (prop.type === 'title') {
          parentName = prop.title.map(t => t.plain_text).join('') || '';
        }
      }

      // 如果 C 表剛好也有直接寫主商品名稱的欄位但上面沒抓到，嘗試用字串欄位補抓
      if (!parentName) {
        const textKey = Object.keys(p).find(k => (k.includes('名稱') || k.includes('品名')) && p[k].type === 'rich_text');
        if (textKey) {
          parentName = p[textKey].rich_text.map(t => t.plain_text).join('');
        }
      }

      // 取得價格 (number 欄位)
      const priceKey = Object.keys(p).find(k => p[k].type === 'number');
      const price = priceKey ? (p[priceKey].number || 0) : 0;

      // 取得圖片 (files 欄位)
      const imgKey = Object.keys(p).find(k => p[k].type === 'files');
      let imageUrl = '';
      if (imgKey && p[imgKey].files?.[0]) {
        const fileObj = p[imgKey].files[0];
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
