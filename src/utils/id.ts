import { nanoid } from 'nanoid';

export const newSessionId = (): string => `ses_${nanoid(16)}`;
