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

    if (!notionToken || !productDetailDbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 Notion 環境變數' });
    }

    const notion = new Client({ auth: notionToken });

    // 1. 查詢 A表（主商品表），過濾狀態為「已結束」的主商品
    let validAMapById = {}; 
    if (productDbId) {
      try {
        const aRes = await notion.databases.query({ database_id: productDbId });
        aRes.results.forEach(page => {
          const p = page.properties;
          let isEnded = false;
          
          const statusKey = Object.keys(p).find(k => p[k].type === 'status' || k.includes('狀態'));
          if (statusKey && p[statusKey].status) {
            const statusVal = p[statusKey].status.name || '';
            if (statusVal.trim() === '已結束') {
              isEnded = true;
            }
          }

          if (!isEnded) {
            const titleKey = Object.keys(p).find(k => p[k].type === 'title');
            if (titleKey && p[titleKey].title?.[0]) {
              const name = p[titleKey].title.map(t => t.plain_text).join('');
              if (name) {
                validAMapById[page.id] = name;
              }
            }
          }
        });
      } catch (e) {
        console.error('A表查詢錯誤:', e.message);
      }
    }

    // 2. 查詢 C表（款式明細表）
    const cRes = await notion.databases.query({ database_id: productDetailDbId });
    const products = [];

    cRes.results.forEach(page => {
      const p = page.properties;

      // 取得主商品名稱（透過 Relation 連結到 A表）
      let parentName = '';
      const relKey = Object.keys(p).find(k => p[k].type === 'relation');
      
      if (relKey && p[relKey].relation.length > 0) {
        const relId = p[relKey].relation[0].id;
        if (Object.keys(validAMapById).length === 0 || validAMapById[relId]) {
          parentName = validAMapById[relId] || '主商品';
        } else {
          return; // 若 A表狀態為已結束，則排除此筆明細
        }
      } else {
        const prodKey = Object.keys(p).find(k => k.includes('商品') || k.includes('品名') || k.includes('名稱') || p[k].type === 'title');
        if (prodKey) {
          const prop = p[prodKey];
          if (prop.type === 'title') parentName = prop.title.map(t => t.plain_text).join('');
          else if (prop.type === 'rich_text') parentName = prop.rich_text.map(t => t.plain_text).join('');
          else if (prop.type === 'select') parentName = prop.select?.name || '';
        }
        if (!parentName) parentName = '精選商品';
      }

      // 取得款式名稱
      let styleName = '標準款式';
      const styleKey = Object.keys(p).find(k => p[k].type === 'title' || k.includes('款式') || k.includes('Spec'));
      if (styleKey && p[styleKey]) {
        const prop = p[styleKey];
        if (prop.type === 'title') styleName = prop.title.map(t => t.plain_text).join('') || '標準款式';
        else if (prop.type === 'rich_text') styleName = prop.rich_text.map(t => t.plain_text).join('') || '標準款式';
      }

      // 抓取單價 (Number 屬性)
      let price = 0;
      const priceKey = Object.keys(p).find(k => (k.includes('價格') || k.includes('單價') || k.includes('Price')) && p[k].type === 'number');
      if (priceKey) {
        price = p[priceKey].number || 0;
      } else {
        const anyNumKey = Object.keys(p).find(k => p[k].type === 'number');
        if (anyNumKey) price = p[anyNumKey].number || 0;
      }

      // 抓取圖片 (Files)
      let imageUrl = '';
      const imgKey = Object.keys(p).find(k => p[k].type === 'files' || k.includes('圖'));
      if (imgKey && p[imgKey].files?.[0]) {
        const fileObj = p[imgKey].files[0];
        imageUrl = fileObj.file?.url || fileObj.external?.url || '';
      }

      // 商品分類 / 地區標籤
      let category = '全部';
      const catKey = Object.keys(p).find(k => k.includes('地區') || k.includes('分類') || k.includes('Tag') || p[k].type === 'select');
      if (catKey) {
        const catProp = p[catKey];
        if (catProp.type === 'select') category = catProp.select?.name || '全部';
        else if (catProp.type === 'multi_select' && catProp.multi_select.length > 0) category = catProp.multi_select[0].name || '全部';
      }

      products.push({
        productName: parentName,
        styleName: styleName,
        price: price,
        imageUrl: imageUrl,
        category: category
      });
    });

    return res.status(200).json({ success: true, products });

  } catch (error) {
    console.error("Get Products Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
