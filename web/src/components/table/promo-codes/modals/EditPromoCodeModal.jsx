import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Avatar,
  Button,
  Card,
  Col,
  Form,
  Row,
  SideSheet,
  Space,
  Spin,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { IconSave, IconClose, IconTickCircle } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../../../helpers';

const { Text, Title } = Typography;

const getInitValues = () => ({
  code: '',
  name: '',
  type: 'quota',
  quota_value: 100000,
  discount_value: 0.9,
  max_uses: 0,
  expires_at: null,
  enabled: true,
});

const EditPromoCodeModal = ({ visible, editingCode, onClose, refresh }) => {
  const { t } = useTranslation();
  const isEdit = !!editingCode?.id;
  const [loading, setLoading] = useState(false);
  const formApiRef = useRef(null);

  // When modal opens, populate form
  useEffect(() => {
    if (!visible || !formApiRef.current) return;
    if (isEdit) {
      const values = {
        ...getInitValues(),
        ...editingCode,
        expires_at: editingCode.expires_at
          ? new Date(editingCode.expires_at)
          : null,
      };
      formApiRef.current.setValues(values);
    } else {
      formApiRef.current.setValues(getInitValues());
    }
  }, [visible, editingCode]);

  const submit = async (values) => {
    setLoading(true);
    try {
      const payload = {
        ...values,
        quota_value: parseInt(values.quota_value) || 0,
        discount_value: parseFloat(values.discount_value) || 0,
        max_uses: parseInt(values.max_uses) || 0,
        expires_at: values.expires_at
          ? values.expires_at instanceof Date
            ? values.expires_at.toISOString()
            : values.expires_at
          : null,
      };

      let res;
      if (isEdit) {
        res = await API.put('/api/promocode/', { ...payload, id: editingCode.id });
      } else {
        res = await API.post('/api/promocode/', payload);
      }

      const { success, message } = res.data;
      if (success) {
        showSuccess(isEdit ? t('邀请码更新成功') : t('邀请码创建成功'));
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
    <SideSheet
      placement={isEdit ? 'right' : 'left'}
      title={
        <Space>
          <Tag color={isEdit ? 'blue' : 'green'} shape='circle'>
            {isEdit ? t('更新') : t('新建')}
          </Tag>
          <Title heading={4} className='m-0'>
            {isEdit ? t('更新邀请码') : t('创建邀请码')}
          </Title>
        </Space>
      }
      bodyStyle={{ padding: 0 }}
      visible={visible}
      width={560}
      footer={
        <div className='flex justify-end bg-white'>
          <Space>
            <Button
              theme='solid'
              icon={<IconSave />}
              loading={loading}
              onClick={() => formApiRef.current?.submitForm()}
            >
              {t('提交')}
            </Button>
            <Button theme='light' icon={<IconClose />} onClick={onClose}>
              {t('取消')}
            </Button>
          </Space>
        </div>
      }
      closeIcon={null}
      onCancel={onClose}
    >
      <Spin spinning={loading}>
        <Form
          initValues={getInitValues()}
          getFormApi={(api) => (formApiRef.current = api)}
          onSubmit={submit}
        >
          {({ values }) => (
            <div className='p-2'>
              <Card className='!rounded-2xl shadow-sm border-0 mb-4'>
                <div className='flex items-center mb-3'>
                  <Avatar size='small' color='blue' className='mr-2 shadow-md'>
                    <IconTickCircle size={16} />
                  </Avatar>
                  <div>
                    <Text className='text-lg font-medium'>{t('基本信息')}</Text>
                    <div className='text-xs text-gray-500'>{t('设置邀请码的基本信息')}</div>
                  </div>
                </div>
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Input
                      field='code'
                      label={t('邀请码')}
                      placeholder={t('例如：WELCOME2025')}
                      style={{ width: '100%' }}
                      rules={[{ required: true, message: t('请输入邀请码') }]}
                      showClear
                    />
                  </Col>
                  <Col span={12}>
                    <Form.Input
                      field='name'
                      label={t('名称（备注）')}
                      placeholder={t('可选')}
                      style={{ width: '100%' }}
                      showClear
                    />
                  </Col>
                  <Col span={12}>
                    <Form.Select
                      field='type'
                      label={t('奖励类型')}
                      style={{ width: '100%' }}
                      rules={[{ required: true }]}
                    >
                      <Form.Select.Option value='quota'>{t('额度奖励')}</Form.Select.Option>
                      <Form.Select.Option value='discount'>{t('充值折扣')}</Form.Select.Option>
                    </Form.Select>
                  </Col>
                  <Col span={12}>
                    <Form.Switch
                      field='enabled'
                      label={t('启用')}
                    />
                  </Col>
                </Row>
              </Card>

              <Card className='!rounded-2xl shadow-sm border-0 mb-4'>
                <div className='flex items-center mb-3'>
                  <Avatar size='small' color='green' className='mr-2 shadow-md'>
                    <IconTickCircle size={16} />
                  </Avatar>
                  <div>
                    <Text className='text-lg font-medium'>{t('奖励设置')}</Text>
                    <div className='text-xs text-gray-500'>{t('根据类型配置奖励值')}</div>
                  </div>
                </div>
                <Row gutter={12}>
                  {values.type === 'quota' && (
                    <Col span={24}>
                      <Form.InputNumber
                        field='quota_value'
                        label={t('赠送额度')}
                        min={1}
                        style={{ width: '100%' }}
                        rules={[
                          { required: true, message: t('请输入额度') },
                          {
                            validator: (_, v) =>
                              parseInt(v) > 0
                                ? Promise.resolve()
                                : Promise.reject(t('额度必须大于0')),
                          },
                        ]}
                      />
                    </Col>
                  )}
                  {values.type === 'discount' && (
                    <Col span={24}>
                      <Form.InputNumber
                        field='discount_value'
                        label={t('折扣率（例如 0.9 表示九折）')}
                        min={0.01}
                        max={0.99}
                        step={0.05}
                        style={{ width: '100%' }}
                        rules={[
                          { required: true, message: t('请输入折扣率') },
                          {
                            validator: (_, v) => {
                              const n = parseFloat(v);
                              return n > 0 && n < 1
                                ? Promise.resolve()
                                : Promise.reject(t('折扣率必须大于0且小于1'));
                            },
                          },
                        ]}
                        extraText={
                          values.discount_value > 0 && values.discount_value < 1
                            ? t('用户充值享受 {{pct}}% 优惠', {
                                pct: ((1 - values.discount_value) * 100).toFixed(0),
                              })
                            : ''
                        }
                      />
                    </Col>
                  )}
                  <Col span={12}>
                    <Form.InputNumber
                      field='max_uses'
                      label={t('最大使用次数（0=不限）')}
                      min={0}
                      style={{ width: '100%' }}
                    />
                  </Col>
                  <Col span={12}>
                    <Form.DatePicker
                      field='expires_at'
                      label={t('过期时间（留空永久）')}
                      type='dateTime'
                      style={{ width: '100%' }}
                      showClear
                    />
                  </Col>
                </Row>
              </Card>
            </div>
          )}
        </Form>
      </Spin>
    </SideSheet>
  );
};

export default EditPromoCodeModal;
