import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const productDbId = process.env.PRODUCT_DB_ID || process.env.DATABASE_ID;       
    const productDetailDbId = process.env.PRODUCT_DETAIL_DB_ID;                   
    const annDbId = process.env.ANNOUNCEMENT_DB_ID;                         // 公告欄資料庫 ID

    if (!productDetailDbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 PRODUCT_DETAIL_DB_ID 環境變數' });
    }

    // 1. 查詢 A表 (若有設定) 建立字典
    let aMapById = {};
    if (productDbId) {
      try {
        const aRes = await notion.databases.query({ database_id: productDbId, page_size: 100 });
        aRes.results.forEach(page => {
          const p = page.properties || {};
          let productName = '';
          const titleKey = Object.keys(p).find(k => p[k]?.type === 'title');
          if (titleKey && p[titleKey]?.title?.length > 0) {
            productName = p[titleKey].title.map(t => t.plain_text || '').join('');
          }
          if (productName) {
            aMapById[page.id] = productName;
          }
        });
      } catch (e) {
        console.log("A表查詢略過或失敗:", e.message);
      }
    }

    // 2. 查詢 C表 (款式明細表)
    const cRes = await notion.databases.query({ database_id: productDetailDbId, page_size: 100 });
    const products = [];

    cRes.results.forEach(page => {
      const p = page.properties || {};

      let styleName = '標準款式';
      const styleKey = Object.keys(p).find(k => p[k]?.type === 'title' || k.includes('款式') || k.includes('規格'));
      if (styleKey && p[styleKey]) {
        if (p[styleKey].type === 'title' && p[styleKey].title) {
          styleName = p[styleKey].title.map(t => t.plain_text || '').join('') || '標準款式';
        } else if (p[styleKey].type === 'rich_text' && p[styleKey].rich_text) {
          styleName = p[styleKey].rich_text.map(t => t.plain_text || '').join('') || '標準款式';
        }
      }

      let productName = '';
      const relKey = Object.keys(p).find(k => p[k]?.type === 'relation');
      if (relKey && p[relKey]?.relation?.length > 0) {
        const parentId = p[relKey].relation[0].id;
        productName = aMapById[parentId] || '';
      }

      if (!productName) {
        const prodNameKey = Object.keys(p).find(k => (k.includes('商品') || k.includes('品名') || k.includes('名稱')) && (p[k]?.type === 'rich_text' || p[k]?.type === 'title'));
        if (prodNameKey && p[prodNameKey]) {
          const prop = p[prodNameKey];
          if (prop.type === 'title' && prop.title) {
            productName = prop.title.map(t => t.plain_text || '').join('');
          } else if (prop.type === 'rich_text' && prop.rich_text) {
            productName = prop.rich_text.map(t => t.plain_text || '').join('');
          }
        }
      }

      if (!productName) productName = '精選商品';

      const priceKey = Object.keys(p).find(k => p[k]?.type === 'number');
      const price = priceKey && p[priceKey]?.number !== undefined ? p[priceKey].number : 0;

      const imgKey = Object.keys(p).find(k => p[k]?.type === 'files');
      let imageUrl = '';
      if (imgKey && p[imgKey]?.files?.length > 0) {
        const fileObj = p[imgKey].files[0];
        imageUrl = fileObj.file?.url || fileObj.external?.url || '';
      }

      let saleType = '預購';
      const typeKey = Object.keys(p).find(k => k.includes('狀態') || k.includes('saleType') || k.includes('type'));
      if (typeKey && p[typeKey]) {
        if (p[typeKey].type === 'select' && p[typeKey].select?.name) {
          saleType = p[typeKey].select.name;
        } else if (p[typeKey].type === 'status' && p[typeKey].status?.name) {
          saleType = p[typeKey].status.name;
        } else if (p[typeKey].type === 'formula') {
          saleType = p[typeKey].formula?.string || p[typeKey].formula?.boolean?.toString() || '預購';
        } else if (p[typeKey].type === 'rich_text' && p[typeKey].rich_text) {
          saleType = p[typeKey].rich_text.map(t => t.plain_text || '').join('') || '預購';
        }
      }

      let deadline = '';
      const dateKey = Object.keys(p).find(k => k.includes('收單') || k.includes('截止') || k.includes('deadline'));
      if (dateKey && p[dateKey]) {
        if (p[dateKey].type === 'date' && p[dateKey].date?.start) {
          deadline = p[dateKey].date.start;
        } else if (p[dateKey].type === 'formula') {
          deadline = p[dateKey].formula?.string || '';
        } else if (p[dateKey].type === 'rich_text' && p[dateKey].rich_text) {
          deadline = p[dateKey].rich_text.map(t => t.plain_text || '').join('');
        }
      }

      let categories = ['全部'];
      const catKey = Object.keys(p).find(k => k.includes('分類') || k.includes('地區') || k.includes('category'));
      if (catKey && p[catKey]) {
        if (p[catKey].type === 'multi_select' && p[catKey].multi_select) {
          categories = p[catKey].multi_select.map(m => m.name).filter(Boolean);
        } else if (p[catKey].type === 'select' && p[catKey].select?.name) {
          categories = [p[catKey].select.name];
        } else if (p[catKey].type === 'rich_text' && p[catKey].rich_text) {
          const text = p[catKey].rich_text.map(t => t.plain_text || '').join('');
          if (text) categories = [text];
        }
      }
      if (categories.length === 0) categories = ['全部'];

      products.push({
        productName,
        styleName,
        price,
        saleType,
        categories,
        imageUrl,
        deadline,
        needDeposit: false,
        description: ''
      });
    });

    // 3. 查詢公告欄資料庫 (Announcements)
    let announcements = [];
    if (annDbId) {
      try {
        const annRes = await notion.databases.query({ database_id: annDbId, page_size: 10 });
        announcements = annRes.results.map(page => {
          const p = page.properties || {};
          let text = '';
          // 自動尋找公告欄位中的文字或標題
          Object.keys(p).forEach(k => {
            const prop = p[k];
            if (prop?.type === 'title' && prop.title?.[0]) {
              text = prop.title.map(t => t.plain_text || '').join('');
            } else if (prop?.type === 'rich_text' && prop.rich_text?.[0]) {
              text = prop.rich_text.map(t => t.plain_text || '').join('');
            }
          });
          return text;
        }).filter(Boolean);
      } catch (e) {
        console.log("公告欄查詢失敗:", e.message);
      }
    }

    return res.status(200).json({ success: true, products, announcements });

  } catch (error) {
    console.error("Get Products Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
