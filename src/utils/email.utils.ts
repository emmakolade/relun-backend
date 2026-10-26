// Sub-addresses like name+tag@gmail.com all reach one inbox, so they'd let one person make many accounts.
export const isPlusAddress = (email: string): boolean => email.split('@')[0].includes('+');

export const PLUS_ADDRESS_ERROR = "Email addresses with '+' can't be used to sign up";
