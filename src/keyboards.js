/** Persistent reply keyboard shown in private bot chats. */
export const mainMenuKeyboard = {
  keyboard: [
    [{ text: "/invoice" }, { text: "/history" }],
    [{ text: "/profile" }, { text: "/payment" }],
    [{ text: "Tax & GST" }, { text: "/help" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};
