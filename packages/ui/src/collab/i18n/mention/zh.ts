/**
 * Collab @-mention picker copy shared by every app (G8-20, spine String catalogue G8: S14). zh defines
 * the key set; every sibling shard satisfies Record<keyof typeof zh, string>. The count key takes
 * one {count} placeholder whose sentence holds for any number.
 */
export const zh = {
  collabMentionLabel: '提及某人',
  collabMentionSearching: '正在搜索…',
  collabMentionCount: '结果：{count}',
  collabMentionNoMatch: '在有权查看此文档的人中，没有匹配“{query}”的人。',
  collabMentionNoCandidates: '还没有其他人可以查看此文档。',
  collabMentionError: '无法加载人员列表。',
}
