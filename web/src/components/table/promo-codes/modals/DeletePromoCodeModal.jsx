import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Space, Typography } from '@douyinfe/semi-ui';
import { API, showError, showSuccess } from '../../../../helpers';

const { Text } = Typography;

const DeletePromoCodeModal = ({ visible, record, onClose, refresh }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!record) return;
    setLoading(true);
    try {
      const res = await API.delete(`/api/promocode/${record.id}`);
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('删除成功'));
        refresh();
        onClose();
      } else {
        showError(message);
      }
    } catch {
      showError(t('请求失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t('确认删除')}
      visible={visible}
      onCancel={onClose}
      footer={
        <Space>
          <Button type='danger' theme='solid' loading={loading} onClick={handleDelete}>
            {t('删除')}
          </Button>
          <Button onClick={onClose}>{t('取消')}</Button>
        </Space>
      }
    >
      <Text>
        {t('确定要删除邀请码')} <Text strong>{record?.code}</Text>{t('吗？此操作不可撤销。')}
      </Text>
    </Modal>
  );
};

export default DeletePromoCodeModal;
