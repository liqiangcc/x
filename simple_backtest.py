from __future__ import (absolute_import, division, print_function,
                        unicode_literals)

import datetime  # For datetime objects
import backtrader as bt

# Create a Strategy
class SmaCross(bt.Strategy):
    params = (
        ('fast_length', 10),
        ('slow_length', 50),
    )

    def __init__(self):
        # Keep a reference to the 'close' line in the data[0] dataseries
        self.dataclose = self.datas[0].close

        # To keep track of pending orders
        self.order = None

        # Add a MovingAverageSimple indicator
        self.slow_sma = bt.indicators.SimpleMovingAverage(
            self.datas[0], period=self.params.slow_length)
        self.fast_sma = bt.indicators.SimpleMovingAverage(
            self.datas[0], period=self.params.fast_length)

        self.crossover = bt.indicators.CrossOver(self.fast_sma, self.slow_sma)

    def next(self):
        # Simply log the closing price of the series from the reference
        # self.log('Close, %.2f' % self.dataclose[0])

        # Check if an order is pending ... if yes, we cannot send a 2nd one
        if self.order:
            return

        # Check if we are in the market
        if not self.position:
            if self.crossover > 0:
                self.order = self.buy()

        elif self.crossover < 0:
            self.order = self.sell()

    def log(self, txt, dt=None):
        ''' Logging function for this strategy'''
        dt = dt or self.datas[0].datetime.date(0)
        print('%s, %s' % (dt.isoformat(), txt))

if __name__ == '__main__':
    # Create a cerebro entity
    cerebro = bt.Cerebro()

    # Add a strategy
    cerebro.addstrategy(SmaCross)

    # Datas are in a subfolder of the samples. Need to find where the script is
    # because it could have been called from anywhere
    datapath = ('./002180_d.csv')

    # Create a Data Feed
    data = bt.feeds.GenericCSVData(
        dataname=datapath,
        fromdate=datetime.datetime(2011, 1, 1),
        todate=datetime.datetime(2012, 12, 31),
        dtformat=(' %Y/%m/%d'),
        openinterest=-1,
        )

    # Add the Data Feed to Cerebro
    cerebro.adddata(data)

    # Set our desired cash start
    cerebro.broker.setcash(100000.0)

    # Print out the starting conditions
    print('Starting Portfolio Value: %.2f' % cerebro.broker.getvalue())

    # Run over everything
    cerebro.run()

    # Print out the final result
    print('Final Portfolio Value: %.2f' % cerebro.broker.getvalue())

    # The plot cannot be displayed in this environment.
    # cerebro.plot()
