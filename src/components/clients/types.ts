export type CompanyRow = {
  id: string;
  name: string;
  emoji: string | null;
  createdAt: string;
  clients: { id: string; name: string; email: string | null }[];
};

export type ClientRow = {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  company: { id: string; name: string; emoji: string | null };
};
