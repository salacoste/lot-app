import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../alerts/alerts-info.module.css';

export const metadata: Metadata = {
  title: 'Как работает AI-оценка лотов | auction.thepeace.ru',
  description: 'Что входит в AI-разбор лота, как публикуется детальный анализ и зачем голосовать за интересные лоты.',
  openGraph: {
    title: 'AI-оценка лотов на торгах | auction.thepeace.ru',
    description: 'Оценка цены и ликвидности, инвестиционное резюме и пользовательское голосование за детальный разбор.',
  },
};

export default function AiAssessmentInfoPage() {
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'Что входит в AI-оценку лота?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Разбор может включать оценку стоимости, балл ликвидности, инвестиционное резюме и детальное объяснение факторов и рисков.',
        },
      },
      {
        '@type': 'Question',
        name: 'Почему у активного лота показан только фрагмент анализа?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Для активных торгов публикуется ознакомительный фрагмент. После завершения торгов подготовленный анализ может отображаться полностью.',
        },
      },
      {
        '@type': 'Question',
        name: 'Сколько лотов можно поддержать голосом?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Базовый аккаунт может одновременно поддержать до 3 лотов, пользователь с активным Pro-доступом — до 10.',
        },
      },
    ],
  };

  return (
    <div className={styles.container}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

      <header className={styles.header}>
        <h1 className={styles.title}>AI-оценка и разбор лотов</h1>
        <p className={styles.subtitle}>
          Алгоритмы помогают быстрее увидеть ценовой потенциал, ликвидность и ключевые риски — но не заменяют юридическую и техническую проверку объекта.
        </p>
      </header>

      <div className={styles.content}>
        <section className={styles.section}>
          <h2>Что вы увидите в разборе</h2>
          <div className={styles.stepsGrid}>
            <div className={styles.stepCard}>
              <div className={styles.stepNumber}>1</div>
              <h3>Оценка стоимости</h3>
              <p>Ориентир по рыночной стоимости и потенциальному дисконту относительно начальной цены торгов.</p>
            </div>
            <div className={styles.stepCard}>
              <div className={styles.stepNumber}>2</div>
              <h3>Ликвидность</h3>
              <p>Балльная оценка того, насколько просто объект может быть реализован с учётом его типа и характеристик.</p>
            </div>
            <div className={styles.stepCard}>
              <div className={styles.stepNumber}>3</div>
              <h3>Риски и аргументы</h3>
              <p>Структурированное резюме и объяснение факторов, которые повлияли на вывод модели.</p>
            </div>
            <div className={styles.stepCard}>
              <div className={styles.stepNumber}>4</div>
              <h3>Публичный доступ</h3>
              <p>У активного лота показывается ознакомительный фрагмент, а у архивного — доступный полный текст анализа.</p>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h2>Как работает голосование</h2>
          <p>
            На странице лота нажмите «Запросить разбор». Голос фиксирует ваш интерес и помогает сформировать приоритет среди лотов-кандидатов. Повторное нажатие не создаёт дубликат, а голос можно отозвать в любой момент.
          </p>
          <p>
            Одновременно можно поддержать до 3 лотов на базовом тарифе и до 10 с активным Pro-доступом. Все выбранные лоты находятся во вкладке «Мои голоса» личного кабинета.
          </p>
        </section>

        <section className={styles.ctaSection}>
          <h2>Выберите лот для разбора</h2>
          <p>Откройте интересующий объект, изучите исходные документы и поддержите его голосом.</p>
          <div className={styles.buttonsWrapper}>
            <Link href="/" className={styles.ctaButton}>Перейти к лотам</Link>
            <Link href="/account?tab=my-votes" className={styles.ctaButton}>Мои голоса</Link>
          </div>
        </section>

        <section className={styles.faqSection}>
          <h2>Важно помнить</h2>
          <div className={styles.faqItem}>
            <h3>AI-оценка — не гарантия доходности</h3>
            <p>Проверяйте документы, ограничения, фактическое состояние имущества и условия торгов самостоятельно или с профильным специалистом.</p>
          </div>
          <div className={styles.faqItem}>
            <h3>Голос не гарантирует срок публикации</h3>
            <p>Он отражает пользовательский интерес и участвует в приоритизации, но сам по себе не является заказом платной услуги.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
