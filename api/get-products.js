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
    const announcementDbId = process.env.ANNOUNCEMENT_DB_ID;

    if (!notionToken || !productDetailDbId) {
      return res.status(500).json({ success: false, error: '伺服器未設定 Notion 環境變數' });
    }

    const notion = new Client({ auth: notionToken });

    // 0. 抓取 Notion 公告
    let announcements = [];
    if (announcementDbId) {
      try {
        const annRes = await notion.databases.query({
          database_id: announcementDbId,
          sorts: [{ timestamp: 'created_time', direction: 'descending' }],
          page_size: 3
        });
        if (annRes && annRes.results) {
          annRes.results.forEach(page => {
            const p = page?.properties || {};
            const descKey = Object.keys(p).find(k => k.includes('內容') || k.includes('說明') || k.includes('公告') || p[k]?.type === 'rich_text');
            if (descKey && p[descKey]?.rich_text?.[0]) {
              const text = p[descKey].rich_text.map(t => t?.plain_text || '').join('');
              if (text) announcements.push(text);
            }
          });
        }
      } catch (err) {
        console.warn('公告讀取略過:', err.message);
      }
    }

    // 1. 查詢 A 表（主商品表），只抓取：名稱、分類、押金
    let validAMap = {};
    if (productDbId) {
      try {
        const aRes = await notion.databases.query({ database_id: productDbId });
        if (aRes && aRes.results) {
          aRes.results.forEach(page => {
            const p = page?.properties || {};
            
            let name = '';
            const titleKey = Object.keys(p).find(k => p[k]?.type === 'title');
            if (titleKey && p[titleKey]?.title && p[titleKey].title.length > 0) {
              name = p[titleKey].title.map(t => t?.plain_text || '').join('');
            }

            if (name) {
              // 抓取分類 (支援 multi_select 或 select)
              let categories = ['伴手禮'];
              const catKey = Object.keys(p).find(k => k && (k.includes('分類') || k.includes('地區') || k.includes('Tag') || k.includes('分區')));
              if (catKey && p[catKey]) {
                const prop = p[catKey];
                if (prop.type === 'multi_select' && Array.isArray(prop.multi_select) && prop.multi_select.length > 0) {
                  categories = prop.multi_select.map(item => item?.name).filter(Boolean);
                } else if (prop.type === 'select' && prop.select?.name) {
                  categories = [prop.select.name];
                } else if (prop.type === 'rich_text' && Array.isArray(prop.rich_text) && prop.rich_text.length > 0) {
                  const txt = prop.rich_text.map(t => t?.plain_text || '').join('').trim();
                  if (txt) categories = [txt];
                }
              }

              // 抓取是否需訂金 (Checkbox 或 Select)
              let needDeposit = false;
              const depositKey = Object.keys(p).find(k => k && (k.includes('訂金') || k.includes('押金')));
              if (depositKey && p[depositKey]) {
                const prop = p[depositKey];
                if (prop.type === 'checkbox') needDeposit = prop.checkbox;
                else if (prop.type === 'select') needDeposit = (prop.select?.name === '是' || prop.select?.name === '需訂金');
              }

              validAMap[page.id] = {
                name,
                categories,
                needDeposit
              };
            }
          });
        }
      } catch (e) {
        console.warn('A表查詢略過或失敗:', e.message);
      }
    }

    // 2. 查詢 C 表（款式明細表），抓取狀態（公式/select）、收單日、價格、圖片
    const cRes = await notion.databases.query({ database_id: productDetailDbId });
    const products = [];

    if (cRes && cRes.results) {
      cRes.results.forEach(page => {
        const p = page?.properties || {};

        // 🎯 檢查 C 表狀態（支援 formula 公式、status、select）
        let saleType = '預購';
        let isEnded = false;
        const statusKey = Object.keys(p).find(k => k && (k.includes('狀態') || p[k]?.type === 'status' || p[k]?.type === 'select' || p[k]?.type === 'formula'));
        if (statusKey && p[statusKey]) {
          const prop = p[statusKey];
          let statusVal = '';
          if (prop.type === 'status') statusVal = prop.status?.name || '';
          else if (prop.type === 'select') statusVal = prop.select?.name || '';
          else if (prop.type === 'formula') {
            statusVal = prop.formula?.string || prop.formula?.boolean?.toString() || prop.formula?.number?.toString() || '';
          }
          
          const trimmedVal = statusVal.trim();
          if (trimmedVal === '已結束' || trimmedVal === '已結單' || trimmedVal === '斷貨' || trimmedVal === '售完' || trimmedVal === 'true') {
            isEnded = true;
            saleType = '已結束';
          } else if (trimmedVal !== '') {
            saleType = trimmedVal; // 例如「現貨」、「預購」
          }
        }

        // 取得主商品資訊（透過 Relation）
        let parentName = '精選預購商品';
        let categories = ['伴手禮'];
        let needDeposit = false;

        const relKey = Object.keys(p).find(k => p[k]?.type === 'relation');
        if (relKey && p[relKey]?.relation && Array.isArray(p[relKey].relation) && p[relKey].relation.length > 0) {
          const relId = p[relKey].relation[0]?.id;
          if (relId && validAMap[relId]) {
            parentName = validAMap[relId].name;
            categories = validAMap[relId].categories;
            needDeposit = validAMap[relId].needDeposit;
          }
        } else {
          // 若無關聯，試著從 C 表抓取名稱
          const titleKey = Object.keys(p).find(k => p[k]?.type === 'title');
          if (titleKey && p[titleKey]?.title && p[titleKey].title.length > 0) {
            parentName = p[titleKey].title.map(t => t?.plain_text || '').join('') || '精選預購商品';
          }
        }

        // 取得 C 表的款式名稱 (Title 屬性)
        let styleName = '標準款式';
        const styleTitleKey = Object.keys(p).find(k => p[k]?.type === 'title');
        if (styleTitleKey && p[styleTitleKey]?.title && p[styleTitleKey].title.length > 0) {
          styleName = p[styleTitleKey].title.map(t => t?.plain_text || '').join('') || '標準款式';
        }

        // 取得 C 表價格
        let price = 0;
        const priceKey = Object.keys(p).find(k => (k.includes('價格') || k.includes('單價') || k.includes('Price')) && p[k]?.type === 'number');
        if (priceKey && p[priceKey]?.number !== undefined) {
          price = p[priceKey].number || 0;
        } else {
          const anyNumKey = Object.keys(p).find(k => k && p[k]?.type === 'number');
          if (anyNumKey && p[anyNumKey]?.number !== undefined) price = p[anyNumKey].number || 0;
        }

        // 取得 C 表圖片
        let imageUrl = '';
        const imgKey = Object.keys(p).find(k => k && (p[k]?.type === 'files' || k.includes('圖')));
        if (imgKey && p[imgKey]?.files && Array.isArray(p[imgKey].files) && p[imgKey].files.length > 0) {
          const fileObj = p[imgKey].files[0];
          if (fileObj) {
            imageUrl = fileObj.file?.url || fileObj.external?.url || '';
          }
        }

        // 取得 C 表收單日
        let deadline = '';
        const dateKey = Object.keys(p).find(k => k && (k.includes('收單') || k.includes('日期') || k.includes('截止') || p[k]?.type === 'date'));
        if (dateKey && p[dateKey]?.date?.start) {
          deadline = p[dateKey].date.start;
        }

        products.push({
          productName: parentName,
          categories: categories,
          saleType: saleType, // 來自 C 表狀態/公式（若為已結束/斷貨會自動歸類到已結單）
          deadline: deadline, // 來自 C 表收單日
          needDeposit: needDeposit, // 來自 A 表押金
          styleName: styleName,     // 來自 C 表款式
          price: price,             // 來自 C 表價格
          imageUrl: imageUrl        // 來自 C 表圖片
        });
      });
    }

    return res.status(200).json({ success: true, announcements, products });

  } catch (error) {
    console.error("Get Products Error:", error);
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
