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
          
          // 檢查狀態是否為「已結束」（只要包含「狀態」或型態為 status）
          Object.keys(p).forEach(k => {
            const prop = p[k];
            if (prop.type === 'status' && prop.status?.name === '已結束') isEnded = true;
            if (k.includes('狀態') && prop.select?.name === '已結束') isEnded = true;
          });

          if (!isEnded) {
            // 抓取主商品名稱 (title)
            let name = '';
            Object.keys(p).forEach(k => {
              if (p[k].type === 'title' && p[k].title?.[0]) {
                name = p[k].title.map(t => t.plain_text).join('');
              }
            });

            if (name) {
              // 🎯 智慧抓取分類（支援 multi_select、select、rich_text）
              let categories = ['伴手禮'];
              Object.keys(p).forEach(k => {
                const prop = p[k];
                if ((k.includes('分類') || k.includes('地區') || k.includes('Tag') || prop.type === 'multi_select' || prop.type === 'select')) {
                  if (prop.type === 'multi_select' && prop.multi_select?.length > 0) {
                    categories = prop.multi_select.map(item => item.name);
                  } else if (prop.type === 'select' && prop.select?.name) {
                    categories = [prop.select.name];
                  } else if (prop.type === 'rich_text' && prop.rich_text?.[0]) {
                    const txt = prop.rich_text.map(t => t.plain_text).join('');
                    if (txt) categories = [txt];
                  }
                }
              });

              // 🎯 智慧抓取「內容介紹」
              let description = '';
              Object.keys(p).forEach(k => {
                const prop = p[k];
                if ((k.includes('介紹') || k.includes('說明') || k.includes('內容')) && prop.type === 'rich_text' && prop.rich_text?.[0]) {
                  description = prop.rich_text.map(t => t.plain_text).join('');
                }
              });

              // 抓取現貨/預購
              let saleType = '預購';
              Object.keys(p).forEach(k => {
                const prop = p[k];
                if ((k.includes('類型') || k.includes('現貨') || k.includes('狀態')) && prop.type === 'select' && prop.select?.name) {
                  saleType = prop.select.name;
                }
              });

              // 抓取收單日期
              let deadline = '';
              Object.keys(p).forEach(k => {
                const prop = p[k];
                if ((k.includes('收單') || k.includes('日期') || k.includes('截止')) && prop.type === 'date' && prop.date?.start) {
                  deadline = prop.date.start;
                }
              });

              // 是否需訂金
              let needDeposit = false;
              Object.keys(p).forEach(k => {
                const prop = p[k];
                if ((k.includes('訂金') || k.includes('押金'))) {
                  if (prop.type === 'checkbox') needDeposit = prop.checkbox;
                  if (prop.type === 'select' && (prop.select?.name === '是' || prop.select?.name === '需訂金')) needDeposit = true;
                }
              });

              validAMap[page.id] = {
                name,
                categories,
                description,
                saleType,
                deadline,
                needDeposit
              };
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
      let relFound = false;

      // 智慧尋找關聯欄位 (relation)
      Object.keys(p).forEach(k => {
        const prop = p[k];
        if (prop.type === 'relation' && prop.relation?.length > 0) {
          const relId = prop.relation[0].id;
          if (validAMap[relId]) {
            parentInfo = validAMap[relId];
            relFound = true;
          }
        }
      });

      // 如果找不到關聯，但 A 表是空的，則給予預設值防呆
      if (!relFound) {
        if (Object.keys(validAMap).length === 0) {
          parentInfo = { name: '精選商品', categories: ['伴手禮'], description: '', saleType: '預購', deadline: '', needDeposit: false };
        } else {
          return; // 若有 A 表但沒對應到關聯，則跳過
        }
      }

      // 🎯 抓取 C 表的款式名稱 (Title 屬性，或包含「款式」、「規格」的欄位)
      let styleName = '標準款式';
      Object.keys(p).forEach(k => {
        const prop = p[k];
        if (prop.type === 'title' && prop.title?.[0]) {
          styleName = prop.title.map(t => t.plain_text).join('') || '標準款式';
        } else if ((k.includes('款式') || k.includes('規格') || k.includes('Spec')) && prop.type === 'rich_text' && prop.rich_text?.[0]) {
          styleName = prop.rich_text.map(t => t.plain_text).join('') || '標準款式';
        }
      });

      // 抓取價格 (number)
      let price = 0;
      Object.keys(p).forEach(k => {
        const prop = p[k];
        if (prop.type === 'number' && prop.number !== undefined) {
          if (k.includes('價格') || k.includes('單價') || k.includes('Price') || price === 0) {
            price = prop.number || 0;
          }
        }
      });

      // 抓取圖片 (files)
      let imageUrl = '';
      Object.keys(p).forEach(k => {
        const prop = p[k];
        if (prop.type === 'files' && prop.files?.[0]) {
          const fileObj = prop.files[0];
          imageUrl = fileObj.file?.url || fileObj.external?.url || '';
        }
      });

      products.push({
        productName: parentInfo.name,
        categories: parentInfo.categories || ['伴手禮'],
        description: parentInfo.description || '',
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
