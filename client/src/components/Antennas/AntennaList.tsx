import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAntennas } from '../../hooks/useAntennas';
import type { Antenna } from '../../hooks/useAntennas';
import AntennaCard from './AntennaCard';
import AntennaModal from './AntennaModal';

export default function AntennaList() {
  const { t } = useTranslation();
  const { antennas, loading, createAntenna, updateAntenna, deleteAntenna } = useAntennas();
  const [showModal, setShowModal] = useState(false);
  const [editingAntenna, setEditingAntenna] = useState<Antenna | null>(null);

  const handleSave = async (name: string, powerWatts: number, gainDbi: number) => {
    if (editingAntenna) {
      await updateAntenna(editingAntenna.id, { name, powerWatts, gainDbi });
    } else {
      await createAntenna(name, powerWatts, gainDbi);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm(t('antennas.confirmDelete'))) {
      await deleteAntenna(id);
    }
  };

  const openEdit = (antenna: Antenna) => {
    setEditingAntenna(antenna);
    setShowModal(true);
  };

  const openAdd = () => {
    setEditingAntenna(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingAntenna(null);
  };

  if (loading) {
    return <div className="text-center text-gray-500 py-8">...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{t('antennas.myAntennas')}</h2>
        <button
          onClick={openAdd}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors text-sm"
        >
          + {t('antennas.addNew')}
        </button>
      </div>

      {antennas.length === 0 ? (
        <div className="text-center text-gray-500 dark:text-gray-400 py-12 bg-gray-50 dark:bg-slate-800 rounded-xl">
          <p>{t('antennas.noAntennas')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {antennas.map(antenna => (
            <AntennaCard
              key={antenna.id}
              antenna={antenna}
              onEdit={() => openEdit(antenna)}
              onDelete={() => handleDelete(antenna.id)}
            />
          ))}
        </div>
      )}

      {showModal && (
        <AntennaModal
          antenna={editingAntenna}
          onSave={handleSave}
          onClose={closeModal}
        />
      )}
    </div>
  );
}
