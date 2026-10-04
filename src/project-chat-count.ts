// #768: a project's chat count leaves out archived chats; those are counted on their own.
export type ChatCountable = { archived?: boolean };

export function countProjectChats(chats: readonly ChatCountable[] | undefined): { active: number; archived: number } {
  let active = 0;
  let archived = 0;
  for (const chat of chats || []) {
    if (chat?.archived) archived += 1;
    else active += 1;
  }
  return { active, archived };
}
