import { Client } from '@notionhq/client';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const notionToken = process.env.NOTION_TOKEN;
    const productDbId = process.env.PRODUCT_DB_ID || process.env.DATABASE_ID;       
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID;                   

    if (!notionToken || !productDbId || !productDetailDbId) {
      return res.status(500).json({ 
        success: false, 
        error: `環境變數未設定完全。NOTION_TOKEN: ${!!notionToken}, PRODUCT_DB_ID: ${!!productDbId}, PRODUCT_DETAIL_DB_ID: ${!!productDetailDbId}` 
      });
    }

    const notion = new Client({ auth: notionToken });

    // 1. 查詢 A表（主商品表）
    const aRes = await notion.databases.query({ database_id: productDbId });
    let aMapById = {};
    
    aRes.results.forEach(page => {
      const p = page.properties;
      const titleKey = Object.keys(p).find(k => p[k].type === 'title');
      if (titleKey && p[titleKey].title?.[0]) {
        const name = p[titleKey].title.map(t => t.plain_text).join('');
        if (name) {
          aMapById[page.id] = name;
        }
      }
    });

    // 2. 查詢 C表（款式明細表）
    const cRes = await notion.databases.query({ database_id: productDetailDbId });
    const products = [];

    cRes.results.forEach(page => {
      const p = page.properties;

      // 取得款式名稱
      let styleName = '標準款式';
      const styleKey = Object.keys(p).find(k => p[k].type === 'title' || p[k].type === 'rich_text');
      if (styleKey) {
        styleName = p[styleKey][p[styleKey].type]?.map(t => t.plain_text).join('') || '標準款式';
      }

      // 透過 Relation 取得所屬 A表主商品名稱
      let parentName = '';
      const relKey = Object.keys(p).find(k => p[k].type === 'relation');
      
      if (relKey && p[relKey].relation.length > 0) {
        const relId = p[relKey].relation[0].id;
        parentName = aMapById[relId] || '';
      }

      // 取得價格 (Number)
      const priceKey = Object.keys(p).find(k => p[k].type === 'number');
      const price = priceKey ? (p[priceKey].number || 0) : 0;

      // 取得圖片 (Files)
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
