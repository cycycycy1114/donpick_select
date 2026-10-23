// 0. 抓取 Notion 公告 (最近 3 筆)
    let announcements = [];
    if (announcementDbId) {
      try {
        const annRes = await notion.databases.query({
          database_id: announcementDbId,
          sorts: [{ timestamp: 'created_time', direction: 'descending' }],
          page_size: 3
        });

        annRes.results.forEach(page => {
          const p = page.properties || {};
          const statusKey = Object.keys(p).find(k => k.includes('狀態') || p[k]?.type === 'status' || p[k]?.type === 'select');
          let isHidden = false;
          if (statusKey && p[statusKey]) {
            const val = p[statusKey].status?.name || p[statusKey].select?.name || '';
            if (val === '隱藏' || val === '關閉' || val === '下架') isHidden = true;
          }

          if (!isHidden) {
            const descKey = Object.keys(p).find(k => k.includes('內容') || k.includes('說明') || k.includes('公告') || p[k]?.type === 'rich_text');
            if (descKey && p[descKey]?.rich_text?.[0]) {
              const text = p[descKey].rich_text.map(t => t.plain_text).join('');
              if (text) announcements.push(text);
            }
          }
        });
      } catch (err) {
        console.warn('公告讀取略過或失敗:', err.message);
      }
    }
