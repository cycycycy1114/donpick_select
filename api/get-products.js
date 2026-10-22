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

    // 1. 查詢 A表（主商品表）
    let validAMap = {}; 

    if (productDbId) {
      try {
        const aRes = await notion.databases.query({ database_id: productDbId });
        aRes.results.forEach(page => {
          const p = page.properties;
          let isEnded = false;
          
          // 檢查狀態是否為「已結束」
          const statusKey = Object.keys(p).find(k => p[k].type === 'status' || k.includes('狀態'));
          if (statusKey && p[statusKey].status) {
            const statusVal = p[statusKey].status.name || '';
            if (statusVal.trim() === '已結束') isEnded = true;
          }

          if (!isEnded) {
            const titleKey = Object.keys(p).find(k => p[k].type === 'title');
            if (titleKey && p[titleKey].title?.[0]) {
              const name = p[titleKey].title.map(t => t.plain_text).join('');
              if (name) {
                // 抓取分類 (支援 select / multi_select / rich_text)
                let category = '伴手禮';
                const catKey = Object.keys(p).find(k => k.includes('分類') || k.includes('地區') || k.includes('Tag') || p[k].type === 'select');
                if (catKey) {
                  const prop = p[catKey];
                  if (prop.type === 'select') category = prop.select?.name || '伴手禮';
                  else if (prop.type === 'multi_select' && prop.multi_select.length > 0) category = prop.multi_select[0].name || '伴手禮';
                  else if (prop.type === 'rich_text') category = prop.rich_text.map(t => t.plain_text).join('') || '伴手禮';
                }

                // 抓取介紹文字 (rich_text)
                let description = '';
                const descKey = Object.keys(p).find(k => k.includes('介紹') || k.includes('說明') || k.includes('Desc') || p[k].type === 'rich_text');
                if (descKey && p[descKey].rich_text) {
                  description = p[descKey].rich_text.map(t => t.plain_text).join('');
                }

                // 抓取預購/現貨與收單日期 (select 或 rich_text 或 date)
                let saleType = '預購'; // 預設預購
                const typeKey = Object.keys(p).find(k => k.includes('類型') || k.includes('現貨') || k.includes('狀態'));
                if (typeKey && p[typeKey].type === 'select') {
                  saleType = p[typeKey].select?.name || '預購';
                }

                let deadline = '';
                const dateKey = Object.keys(p).find(k => k.includes('收單') || k.includes('日期') || k.includes('截止') || p[k].type === 'date');
                if (dateKey && p[dateKey].date) {
                  deadline = p[dateKey].date.start || '';
                }

                // 是否需訂金 (checkbox 或 select)
                let needDeposit = false;
                const depositKey = Object.keys(p).find(k => k.includes('訂金') || k.includes('押金'));
                if (depositKey) {
                  if (p[depositKey].type === 'checkbox') needDeposit = p[depositKey].checkbox;
                  else if (p[depositKey].type === 'select') needDeposit = (p[depositKey].select?.name === '是' || p[depositKey].select?.name === '需訂金');
                }

                validAMap[page.id] = {
                  name,
                  category,
                  description,
                  saleType,
                  deadline,
                  needDeposit
                };
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

      let parentInfo = null;
      const relKey = Object.keys(p).find(k => p[k].type === 'relation');
      
      if (relKey && p[relKey].relation.length > 0) {
        const relId = p[relKey].relation[0].id;
        if (validAMap[relId]) {
          parentInfo = validAMap[relId];
        } else {
          return; // 已結束或未找到主商品，排除
        }
      } else {
        return; // 未關聯 A表則排除
      }

      // 🎯 抓取 C表的款式名稱 (title)
      let styleName = '標準款式';
      const styleKey = Object.keys(p).find(k => k.type === 'title' || k.includes('款式') || k.includes('Spec') || k.includes('名稱'));
      if (styleKey && p[styleKey]) {
        const prop = p[styleKey];
        if (prop.type === 'title') styleName = prop.title.map(t => t.plain_text).join('') || '標準款式';
        else if (prop.type === 'rich_text') styleName = prop.rich_text.map(t => t.plain_text).join('') || '標準款式';
      }

      // 抓取價格 (number)
      let price = 0;
      const priceKey = Object.keys(p).find(k => (k.includes('價格') || k.includes('單價') || k.includes('Price')) && p[k].type === 'number');
      if (priceKey) {
        price = p[priceKey].number || 0;
      } else {
        const anyNumKey = Object.keys(p).find(k => p[k].type === 'number');
        if (anyNumKey) price = p[anyNumKey].number || 0;
      }

      // 抓取圖片 (files)
      let imageUrl = '';
      const imgKey = Object.keys(p).find(k => p[k].type === 'files' || k.includes('圖'));
      if (imgKey && p[imgKey].files?.[0]) {
        const fileObj = p[imgKey].files[0];
        imageUrl = fileObj.file?.url || fileObj.external?.url || '';
      }

      products.push({
        productName: parentInfo.name,
        category: parentInfo.category,
        description: parentInfo.description,
        saleType: parentInfo.saleType,
        deadline: parentInfo.deadline,
        needDeposit: parentInfo.needDeposit,
        styleName: styleName,
        price: price,
        imageUrl: imageUrl
      });
    });

    return res.status(200).json({ success: true, products });

  } catch (error) {
    console.error("Get Products Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
