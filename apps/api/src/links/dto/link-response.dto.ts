export class LinkResponseDto {
  id: string;
  slug: string;
  shortUrl: string;
  destination: string;
  title: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  clickCount?: number;
}
