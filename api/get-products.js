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
      return res.status(500).json({ success: false, error: '伺服器未設定 Notion 環境變數' });
    }

    const notion = new Client({ auth: notionToken });

    // 1. 查詢 A表（主商品表），過濾掉狀態結束的商品，建立正常商品的字典
    const aRes = await notion.databases.query({ database_id: productDbId });
    let validAMapById = {}; // 存放有效的 A表 ID -> 名稱

    aRes.results.forEach(page => {
      const p = page.properties;

      // 檢查 A表的狀態欄位
      const statusKey = Object.keys(p).find(k => k.includes('狀態') || p[k].type === 'status' || p[k].type === 'select');
      if (statusKey) {
        let statusVal = '';
        if (p[statusKey].type === 'status') {
          statusVal = p[statusKey].status?.name || '';
        } else if (p[statusKey].type === 'select') {
          statusVal = p[statusKey].select?.name || '';
        } else if (p[statusKey].type === 'rich_text') {
          statusVal = p[statusKey].rich_text.map(t => t.plain_text).join('') || '';
        }
        
        // 如果 A表狀態含有結束、已收單、下架、售完，則此主商品直接略過
        const hideKeywords = ['結束', '已收單', '下架', '售完', '關閉', '完售'];
        if (hideKeywords.some(kw => statusVal.includes(kw))) {
          return; 
        }
      }

      // 取得 A表的主商品名稱 (Title 屬性)
      const titleKey = Object.keys(p).find(k => p[k].type === 'title');
      if (titleKey && p[titleKey].title?.[0]) {
        const name = p[titleKey].title.map(t => t.plain_text).join('');
        if (name) {
          validAMapById[page.id] = name;
        }
      }
    });

    // 2. 查詢 C表（款式明細表）
    const cRes = await notion.databases.query({ database_id: productDetailDbId });
    const products = [];

    cRes.results.forEach(page => {
      const p = page.properties;

      // 找到 C表連結到 A表的 Relation 欄位
      let parentName = '';
      const relKey = Object.keys(p).find(k => p[k].type === 'relation');
      
      if (relKey && p[relKey].relation.length > 0) {
        const relId = p[relKey].relation[0].id;
        // 檢查這個 A表的 ID 是否在我們的合法清單內（也就是 A表狀態必須是正常進行中）
        if (validAMapById[relId]) {
          parentName = validAMapById[relId];
        } else {
          return; // 如果 A表已經結單或不在清單中，這筆明細直接跳過！
        }
      } else {
        // 如果沒有用 relation，退回用文字欄位匹配 A表名稱
        const prodKey = Object.keys(p).find(k => k.includes('商品') || k.includes('品名') || k.includes('名稱'));
        if (prodKey && p[prodKey].type === 'rich_text') {
          const textName = p[prodKey].rich_text.map(t => t.plain_text).join('');
          if (validAMapById[textName] || Object.values(validAMapById).includes(textName)) {
            parentName = textName;
          } else {
            return;
          }
        } else {
          return;
        }
      }

      // 取得款式名稱
      let styleName = '標準款式';
      const styleKey = Object.keys(p).find(k => k[k].type === 'title' || (k.includes('款式') && k[k].type === 'rich_text'));
      if (styleKey) {
        styleName = p[styleKey][p[styleKey].type]?.map(t => t.plain_text).join('') || '標準款式';
      }

      // 精準抓取單價 (強制對應 number 屬性)
      let price = 0;
      const priceKey = Object.keys(p).find(k => (k.includes('價格') || k.includes('單價') || k.includes('Price')) && p[k].type === 'number');
      if (priceKey) {
        price = p[priceKey].number || 0;
      } else {
        const anyNumKey = Object.keys(p).find(k => p[k].type === 'number');
        if (anyNumKey) price = p[anyNumKey].number || 0;
      }

      // 取得圖片 (Files)
      const imgKey = Object.keys(p).find(k => k[k].type === 'files' || k.includes('圖'));
      let imageUrl = '';
      if (imgKey && p[imgKey].files?.[0]) {
        const fileObj = p[imgKey].files[0];
        imageUrl = fileObj.file?.url || fileObj.external?.url || '';
      }

      // 商品分類 / 地區標籤
      let category = '全部';
      const catKey = Object.keys(p).find(k => k.includes('地區') || k.includes('分類') || k.includes('Tag') || k.includes('分區'));
      if (catKey) {
        if (p[catKey].type === 'select') {
          category = p[catKey].select?.name || '全部';
        } else if (p[catKey].type === 'multi_select' && p[catKey].multi_select.length > 0) {
          category = p[catKey].multi_select[0].name || '全部';
        } else if (p[catKey].type === 'rich_text') {
          category = p[catKey].rich_text.map(t => t.plain_text).join('') || '全部';
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
