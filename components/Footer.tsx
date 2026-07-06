import Link from "next/link";
import VersionDisplay from "@/components/VersionDisplay";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-container">
        <p>
          auction.thepeace.ru — сервис для поиска и анализа лотов с торгов по банкротству. Вся информация собирается из открытых официальных источников.
        </p>
        <p>
          Используя сервис, вы соглашаетесь с <Link href="/agreement">Пользовательским соглашением</Link> и <Link href="/privacy">Политикой конфиденциальности</Link>.
          Оплачивая услуги, вы принимаете <Link href="/terms">Публичную оферту</Link>.
        </p>
        <p>
          ИП Степанов Дмитрий Александрович | Email: <a href="mailto:info@auction.thepeace.ru">info@auction.thepeace.ru</a>
        </p>
        <VersionDisplay />
        <nav>
          <Link href="/subscribe" className="footer-link">Тарифы</Link>
          <Link href="/how-it-works/alerts" className="footer-link">Умная рассылка</Link>
          <Link href="/how-it-works/similar-lots" className="footer-link">Похожие лоты</Link>
          {/* <Link href="/terms" className="footer-link">Публичная оферта</Link> */}
          <Link href="/requisites" className="footer-link">Реквизиты</Link>
        </nav>
      </div>
    </footer>
  );
}
