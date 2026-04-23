<template>
	<view class="container">
		<view class="rfid-box">
			<view class="m-title">RFID模块</view>
			<view class="actions">
				<button type="primary" @click="openRFID" :disabled="isRFIDOpen">打开RFID功能</button>
				<button type="warn" @click="closeRFID" :disabled="!isRFIDOpen">关闭RFID功能</button>
			</view>
			<view class="actions">
				<button type="primary" @click="setRfidModeToBatch" :disabled="!(isRFIDOpen && rfidType === 1)">批量盘存</button>
				<button type="primary" @click="setRfidModeToSingle" :disabled="!(isRFIDOpen && rfidType === 0)">单次读取</button>
			</view>
			<view class="data-area">
				<view class="summary">
					<text>扫描状态: {{ isScanning ? '扫描中...' : '已停止' }}</text>
					<text>标签总数: {{ rfidTagList.length }}</text>
					<text @click="clearList">清空</text>
				</view>

				<scroll-view scroll-y class="tag-list">
					<view class="tag-item header">
						<text class="epc">EPC</text>
						<text class="tid">TID</text>
						<text class="rssi">RSSI</text>
						<text class="count">次数</text>
					</view>
					<view v-if="rfidTagList.length === 0" class="empty-tip">
						<text>暂无数据，请开始扫描</text>
					</view>
					<view v-for="(tag, index) in rfidTagList" :key="tag.epc" class="tag-item">
						<text class="epc">{{ tag.epc }}</text>
						<text class="tid">{{ tag.tid }}</text>
						<text class="rssi">{{ tag.rssi }}</text>
						<text class="count">{{ tag.count }}</text>
					</view>
				</scroll-view>
			</view>
		</view>
	</view>
</template>

<script>
	const rfidManager = uni.requireNativePlugin("TH-PlatformRFID")
	export default {
		data() {
			return {
				rfidTagList: [],
				isScanning: false,
				isRFIDOpen: false,
				rfidType: 0
			}
		},
		mounted() {
			this.initRFID()
		},
		onUnload() {
			rfidManager.release();
			plus.key.removeEventListener("keydown", function(e) {}); //移除监听手柄按键按下
			plus.key.removeEventListener("keyup", function(e) {}); //移除监听手柄按键抬起
		},
		methods: {
			initRFID() {
				
				// rfidManager.setBeepEnable(true)
				
				rfidManager.onInventoryTag((result) => {
					rfidManager.soundPlay(1);
					const existingTag = this.rfidTagList.find(tag => tag.epc === result.epc);
					if (existingTag) {
						existingTag.rssi = result.rssi;
						existingTag.count++;
					} else {
						this.rfidTagList.unshift({
							epc: result.epc,
							tid: result.data,
							rssi: result.rssi,
							count: 1
						});
					}
				});
				rfidManager.onInventoryTagEnd((ret) => {
					console.log('onInventoryTagEnd---', ret)
					this.isScanning = false
				});
				let _that = this
				plus.key.addEventListener("keydown", function(e) { //监听手柄按键按下，调用开始盘点方法，开始盘点
					if (e.keyCode == 523) {
						if (_that.isRFIDOpen) {
							if (_that.rfidType === 0) {
								if (_that.isScanning) {
									rfidManager.stopInventory();
								}
								if (!_that.isScanning) {
									_that.isScanning = true
									rfidManager.startInventory();
								}
							}
							if (_that.rfidType === 1) {
								rfidManager.inventorySingle();
							}
						}
					}
				});
			},
			openRFID() {
				uni.showLoading({
					title: '正在开启RFID...'
				})
				rfidManager.init((res) => {
					console.log("init : " + res)
					uni.hideLoading()
					rfidManager.setQueryMode(1);
					var ret = rfidManager.setBeepEnable(true)
					console.log("  ret : " +ret  )
					if (res) {
						this.isRFIDOpen = true
					} else {
						uni.showToast({
							title: 'RFID开启失败',
							icon: 'error'
						})
					}
				});
			},
			closeRFID() {
				rfidManager.release();
				rfidManager.power(false, (result) => {
					console.log('rfidManager.power: ' + result);
				});
				// rfidManager.enableScanHead(true);
				this.isRFIDOpen = false
			},
			setRfidModeToBatch() {
				this.rfidType = 0
			},
			setRfidModeToSingle() {
				this.rfidType = 1
			},
			clearList() {
				this.rfidTagList = []
			}
		
		
		}
	}
</script>

<style lang="scss" scoped>
	.container {
		box-sizing: border-box;
		padding: 20rpx;
		display: flex;
		flex-direction: column;
		height: 100vh;


		.m-title {
			line-height: 70rpx;
			font-weight: bold;
			text-align: center;
		}

		.scan-box {

			.input-area,
			.broadcast-area {
				.title {
					font-weight: bold;
					border-bottom: 1px solid #eeeeee;
				}

				.content {
					.inp {
						display: flex;
						align-items: center;
						height: 72rpx;
					}
				}
			}
		}
	}

	.actions {
		display: flex;
		justify-content: space-around;
		margin-bottom: 20rpx;

		button {
			flex: 1;
			margin: 0 10rpx;
			font-size: 28rpx;
		}

		.start-button {
			background-color: #28a745;
			color: white;
		}

		.stop-button {
			background-color: #dc3545;
			color: white;
		}
	}



	.data-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		border: 1px solid #eee;
		border-radius: 10rpx;
		overflow: hidden;
	}

	.summary {
		display: flex;
		justify-content: space-between;
		padding: 20rpx;
		background-color: #f8f9fa;
		border-bottom: 1px solid #eee;
		font-size: 28rpx;
	}

	.tag-list {
		height: 100%;
	}

	.tag-item {
		display: flex;
		padding: 15rpx;
		border-bottom: 1px solid #f0f0f0;
		font-size: 24rpx;
		font-family: monospace;
		align-items: center;
	}

	.tag-item.header {
		background-color: #e9ecef;
		font-weight: bold;
	}

	.epc {
		width: 40%;
		overflow: hidden;
	}

	.tid {
		width: 40%;
		overflow: hidden;
	}

	.rssi {
		width: 12%;
		text-align: center;
	}

	.count {
		width: 8%;
		text-align: center;
	}

	.empty-tip {
		text-align: center;
		padding: 50rpx;
		color: #999;
	}
</style>