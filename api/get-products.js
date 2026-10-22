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
      return res.status(500).json({ success: false, error: '缺少 Notion 環境變數' });
    }

    const notion = new Client({ auth: notionToken });

    // 1. 查詢 A 表
    let validAMapById = {}; 
    if (productDbId) {
      try {
        const aRes = await notion.databases.query({ database_id: productDbId });
        console.log(`[A表] 抓到的主商品數量: ${aRes.results.length}`);
        
        aRes.results.forEach(page => {
          const p = page.properties;
          let isEnded = false;
          
          const statusKey = Object.keys(p).find(k => p[k].type === 'status' || k.includes('狀態'));
          if (statusKey && p[statusKey].status) {
            const statusVal = p[statusKey].status.name || '';
            console.log(`[A表狀態] ${page.id} 狀態值為: "${statusVal}"`);
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
        console.log('[A表查詢錯誤]:', e.message);
      }
    }

    // 2. 查詢 C 表
    const cRes = await notion.databases.query({ database_id: productDetailDbId });
    console.log(`[C表] 抓到的款式明細數量: ${cRes.results.length}`);
    
    const products = [];

    cRes.results.forEach((page, idx) => {
      const p = page.properties;
      console.log(`--- 檢查 C表第 ${idx+1} 筆資料的欄位 ---`, Object.keys(p));

      let parentName = '';
      const relKey = Object.keys(p).find(k => p[k].type === 'relation');
      
      if (relKey && p[relKey].relation.length > 0) {
        const relId = p[relKey].relation[0].id;
        if (Object.keys(validAMapById).length === 0 || validAMapById[relId]) {
          parentName = validAMapById[relId] || '主商品';
        } else {
          console.log(`[過濾] 該筆明細因 A表狀態為已結束而被排除`);
          return; 
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

      let styleName = '標準款式';
      const styleKey = Object.keys(p).find(k => p[k].type === 'title' || k.includes('款式') || k.includes('Spec'));
      if (styleKey && p[styleKey]) {
        const prop = p[styleKey];
        if (prop.type === 'title') styleName = prop.title.map(t => t.plain_text).join('') || '標準款式';
        else if (prop.type === 'rich_text') styleName = prop.rich_text.map(t => t.plain_text).join('') || '標準款式';
      }

      let price = 0;
      const priceKey = Object.keys(p).find(k => (k.includes('價格') || k.includes('單價') || k.includes('Price')) && p[k].type === 'number');
      if (priceKey) {
        price = p[priceKey].number || 0;
      } else {
        const anyNumKey = Object.keys(p).find(k => p[k].type === 'number');
        if (anyNumKey) price = p[anyNumKey].number || 0;
      }

      let imageUrl = '';
      const imgKey = Object.keys(p).find(k => p[k].type === 'files' || k.includes('圖'));
      if (imgKey && p[imgKey].files?.[0]) {
        const fileObj = p[imgKey].files[0];
        imageUrl = fileObj.file?.url || fileObj.external?.url || '';
      }

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

    console.log(`[成功組裝] 準備回傳前端的商品數: ${products.length}`);
    return res.status(200).json({ success: true, products });

  } catch (error) {
    console.error("Get Products Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
