import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Space,
  Table,
  Tag,
  Typography,
  Input,
  Tooltip,
  Switch,
} from '@douyinfe/semi-ui';
import { IconPlus, IconSearch, IconEdit, IconDelete } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../../helpers';
import EditPromoCodeModal from './modals/EditPromoCodeModal';
import DeletePromoCodeModal from './modals/DeletePromoCodeModal';

const { Text } = Typography;

const PromoCodesTable = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [promoCodes, setPromoCodes] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');

  const [showEdit, setShowEdit] = useState(false);
  const [editingCode, setEditingCode] = useState({});
  const [showDelete, setShowDelete] = useState(false);
  const [deletingCode, setDeletingCode] = useState(null);

  const fetchCodes = useCallback(async (pageNum, size, kw) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ p: pageNum, page_size: size });
      if (kw) params.append('keyword', kw);
      const url = kw
        ? `/api/promocode/search?${params}`
        : `/api/promocode/?${params}`;
      const res = await API.get(url);
      const { success, message, data } = res.data;
      if (success) {
        setPromoCodes(data.items || []);
        setTotal(data.total || 0);
      } else {
        showError(message);
      }
    } catch (e) {
      showError(t('请求失败'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchCodes(page, pageSize, keyword);
  }, [page, pageSize]);

  const handleSearch = () => {
    setPage(1);
    fetchCodes(1, pageSize, keyword);
  };

  const handleToggleEnabled = async (record) => {
    try {
      const res = await API.put('/api/promocode/', {
        ...record,
        enabled: !record.enabled,
      });
      const { success, message } = res.data;
      if (success) {
        showSuccess(t('更新成功'));
        fetchCodes(page, pageSize, keyword);
      } else {
        showError(message);
      }
    } catch {
      showError(t('请求失败'));
    }
  };

  const columns = [
    {
      title: t('ID'),
      dataIndex: 'id',
      width: 60,
    },
    {
      title: t('邀请码'),
      dataIndex: 'code',
      render: (text) => (
        <Text code copyable={{ content: `${window.location.origin}/register?aff=${text}` }}>
          {text}
        </Text>
      ),
    },
    {
      title: t('名称'),
      dataIndex: 'name',
      render: (text) => text || '-',
    },
    {
      title: t('类型'),
      dataIndex: 'type',
      render: (type) =>
        type === 'quota' ? (
          <Tag color='blue'>{t('额度')}</Tag>
        ) : (
          <Tag color='green'>{t('折扣')}</Tag>
        ),
    },
    {
      title: t('奖励值'),
      render: (_, record) => {
        if (record.type === 'quota') {
          return <Text>{record.quota_value.toLocaleString()}</Text>;
        }
        return (
          <Text>
            {((1 - record.discount_value) * 100).toFixed(0)}% off ({record.discount_value})
          </Text>
        );
      },
    },
    {
      title: t('使用次数'),
      render: (_, record) => (
        <Text>
          {record.used_count}
          {record.max_uses > 0 ? ` / ${record.max_uses}` : ` / ∞`}
        </Text>
      ),
    },
    {
      title: t('过期时间'),
      dataIndex: 'expires_at',
      render: (v) =>
        v ? new Date(v).toLocaleString() : <Tag color='grey'>{t('永久')}</Tag>,
    },
    {
      title: t('启用'),
      dataIndex: 'enabled',
      render: (enabled, record) => (
        <Switch
          checked={enabled}
          onChange={() => handleToggleEnabled(record)}
          size='small'
        />
      ),
    },
    {
      title: t('操作'),
      fixed: 'right',
      width: 120,
      render: (_, record) => (
        <Space>
          <Tooltip content={t('编辑')}>
            <Button
              icon={<IconEdit />}
              size='small'
              theme='light'
              onClick={() => {
                setEditingCode(record);
                setShowEdit(true);
              }}
            />
          </Tooltip>
          <Tooltip content={t('删除')}>
            <Button
              icon={<IconDelete />}
              size='small'
              theme='light'
              type='danger'
              onClick={() => {
                setDeletingCode(record);
                setShowDelete(true);
              }}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Card
        className='!rounded-2xl shadow-sm border-0'
        title={
          <div className='flex items-center justify-between flex-wrap gap-2'>
            <Text className='text-lg font-semibold'>{t('邀请码管理')}</Text>
            <Space>
              <Input
                prefix={<IconSearch />}
                placeholder={t('搜索名称或邀请码')}
                value={keyword}
                onChange={setKeyword}
                onEnterPress={handleSearch}
                showClear
                style={{ width: 220 }}
              />
              <Button icon={<IconSearch />} onClick={handleSearch}>
                {t('搜索')}
              </Button>
              <Button
                icon={<IconPlus />}
                theme='solid'
                onClick={() => {
                  setEditingCode({});
                  setShowEdit(true);
                }}
              >
                {t('新建邀请码')}
              </Button>
            </Space>
          </div>
        }
      >
        <Table
          columns={columns}
          dataSource={promoCodes}
          loading={loading}
          rowKey='id'
          scroll={{ x: 'max-content' }}
          pagination={{
            currentPage: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50],
            onPageChange: setPage,
            onPageSizeChange: (size) => {
              setPageSize(size);
              setPage(1);
            },
          }}
        />
      </Card>

      <EditPromoCodeModal
        visible={showEdit}
        editingCode={editingCode}
        onClose={() => setShowEdit(false)}
        refresh={() => fetchCodes(page, pageSize, keyword)}
      />

      <DeletePromoCodeModal
        visible={showDelete}
        record={deletingCode}
        onClose={() => setShowDelete(false)}
        refresh={() => fetchCodes(page, pageSize, keyword)}
      />
    </>
  );
};

export default PromoCodesTable;
