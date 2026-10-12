import { useTranslation } from 'react-i18next';
import type { useMapSearch } from './useMapSearch';
import styles from '../UnifiedMap.module.css';

export default function SearchBox({ search }: { search: ReturnType<typeof useMapSearch> }) {
  const { t } = useTranslation();
  const { searchSectionRef, searchQuery, setSearchQuery, searchResults, showSearchResults, setShowSearchResults, handleSearch, handleSearchResultClick } = search;

  return (
    <div className={styles.searchSection} ref={searchSectionRef}>
      <div className={styles.searchInputWrapper}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder={t('los.map.searchPlaceholder')}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSearch(searchQuery);
            if (e.key === 'Escape') setShowSearchResults(false);
          }}
          onFocus={() => searchResults.length > 0 && setShowSearchResults(true)}
        />
        <button className={styles.searchBtn} onClick={() => handleSearch(searchQuery)} aria-label={t('los.map.searchPlaceholder')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
        </button>
      </div>
      {showSearchResults && searchResults.length > 0 && (
        <div className={styles.searchResults}>
          {searchResults.map((r, i) => (
            <button key={i} className={styles.searchResultItem} onClick={() => handleSearchResultClick(r)}>
              {r.displayName.split(',').slice(0, 2).join(', ')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
