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

    if (!notionToken || !productDetailDbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 Notion 環境變數' });
    }

    const notion = new Client({ auth: notionToken });

    // 1. 查詢 A表（主商品表）建立字典
    let aMapById = {};
    if (productDbId) {
      try {
        const aRes = await notion.databases.query({ database_id: productDbId });
        aRes.results.forEach(page => {
          const p = page.properties;
          const titleKey = Object.keys(p).find(k => p[k].type === 'title');
          if (titleKey && p[titleKey].title?.[0]) {
            const name = p[titleKey].title.map(t => t.plain_text).join('');
            if (name) aMapById[page.id] = name;
          }
        });
      } catch (e) {
        console.log('A表查詢略過:', e.message);
      }
    }

    // 2. 查詢 C表（款式明細表）
    const cRes = await notion.databases.query({ database_id: productDetailDbId });
    const products = [];

    cRes.results.forEach(page => {
      const p = page.properties;

      // 檢查狀態：如果狀態含有結束、已收單、下架、售完，直接跳過不顯示
      const statusKey = Object.keys(p).find(k => k.includes('狀態') || p[k].type === 'status' || p[k].type === 'select');
      if (statusKey) {
        let statusVal = '';
        if (p[statusKey].type === 'status') {
          statusVal = p[statusKey].status?.name || '';
        } else if (p[statusKey].type === 'select') {
          statusVal = p[statusKey].select?.name || '';
        }
        const hideKeywords = ['結束', '已收單', '下架', '售完', '關閉', '完售'];
        if (hideKeywords.some(kw => statusVal.includes(kw))) {
          return; 
        }
      }

      // 款式名稱
      let styleName = '標準款式';
      const styleKey = Object.keys(p).find(k => p[k].type === 'title' || p[k].type === 'rich_text');
      if (styleKey) {
        styleName = p[styleKey][p[styleKey].type]?.map(t => t.plain_text).join('') || '標準款式';
      }

      // 主商品名稱 (透過 Relation 或直接文字)
      let parentName = '';
      const relKey = Object.keys(p).find(k => p[k].type === 'relation');
      if (relKey && p[relKey].relation.length > 0) {
        parentName = aMapById[p[relKey].relation[0].id] || '';
      }
      if (!parentName) {
        const prodKey = Object.keys(p).find(k => k.includes('商品') || k.includes('品名'));
        if (prodKey && p[prodKey].type === 'rich_text') {
          parentName = p[prodKey].rich_text.map(t => t.plain_text).join('');
        }
      }

      // 🎯 精準抓取單價：強制尋找屬性為 number 的欄位（避免抓錯欄位）
      let price = 0;
      const priceKey = Object.keys(p).find(k => (k.includes('價格') || k.includes('單價') || k.includes('Price')) && p[k].type === 'number');
      if (priceKey) {
        price = p[priceKey].number || 0;
      } else {
        // 如果沒找到特定關鍵字，就抓第一個出現的數字欄位
        const anyNumKey = Object.keys(p).find(k => p[k].type === 'number');
        if (anyNumKey) {
          price = p[anyNumKey].number || 0;
        }
      }

      // 圖片 (Files)
      const imgKey = Object.keys(p).find(k => p[k].type === 'files');
      let imageUrl = '';
      if (imgKey && p[imgKey].files?.[0]) {
        const fileObj = imgKey.files[0];
        imageUrl = fileObj.file?.url || fileObj.external?.url || '';
      }

      // 商品分類 (例如地區：東京、大阪、福岡)
      let category = '全部';
      const catKey = Object.keys(p).find(k => k.includes('地區') || k.includes('分類') || k.includes('Tag') || k.includes('分區'));
      if (catKey) {
        if (p[catKey].type === 'select') {
          category = p[catKey].select?.name || '其他';
        } else if (p[catKey].type === 'multi_select' && p[catKey].multi_select.length > 0) {
          category = p[catKey].multi_select[0].name || '其他';
        } else if (p[catKey].type === 'rich_text') {
          category = p[catKey].rich_text.map(t => t.plain_text).join('') || '其他';
        }
      }

      if (parentName) {
        products.push({
          productName: parentName,
          styleName: styleName,
          price: price,
          imageUrl: imageUrl,
          category: category
        });
      }
    });

    return res.status(200).json({ success: true, products });

  } catch (error) {
    console.error("Get Products Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
